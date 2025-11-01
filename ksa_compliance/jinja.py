import base64
import datetime
from base64 import b64encode
from io import BytesIO
from typing import cast, Optional
from PIL import Image
import qrcode
from io import BytesIO
from PIL import Image

import pyqrcode

import frappe
from erpnext.accounts.doctype.pos_invoice.pos_invoice import POSInvoice
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice
from erpnext.setup.doctype.branch.branch import Branch
from frappe.utils.data import get_time, getdate
from ksa_compliance.ksa_compliance.doctype.zatca_business_settings.zatca_business_settings import ZATCABusinessSettings


def get_zatca_phase_1_qr_for_invoice(invoice_name: str) -> str:
    values = get_qr_inputs(invoice_name)
    if values is None:
        return values
    decoded_string = generate_decoded_string(values)
    return generate_qrcode(decoded_string)


def get_qr_inputs(invoice_name: str) -> list:
    invoice_doc: Optional[SalesInvoice] = None
    if frappe.db.exists('POS Invoice', invoice_name):
        invoice_doc = cast(POSInvoice, frappe.get_doc('POS Invoice', invoice_name))
    elif frappe.db.exists('Sales Invoice', invoice_name):
        invoice_doc = cast(SalesInvoice, frappe.get_doc('Sales Invoice', invoice_name))
    else:
        return None
    seller_name = invoice_doc.company
    phase_1_name = frappe.get_value('ZATCA Phase 1 Business Settings', {'company': seller_name})
    if not phase_1_name:
        return None
    phase_1_settings = frappe.get_doc('ZATCA Phase 1 Business Settings', phase_1_name)
    if phase_1_settings.status == 'Disabled':
        return None
    seller_vat_reg_no = phase_1_settings.vat_registration_number
    time = invoice_doc.posting_time
    timestamp = format_date(invoice_doc.posting_date, time)
    grand_total = invoice_doc.grand_total
    total_vat = invoice_doc.total_taxes_and_charges
    # returned values should be ordered based on ZATCA Qr Specifications
    return [seller_name, seller_vat_reg_no, timestamp, grand_total, total_vat]


def generate_decoded_string(values: list) -> str:
    encoded_text = ''
    for tag, value in enumerate(values, 1):
        encoded_text += encode_input(value, [tag])
    # Decode hex result string into base64 format
    return b64encode(bytes.fromhex(encoded_text)).decode()


def encode_input(input: str, tag: int) -> str:
    """
    1- Convert bytes of tag into hex format.
    2- Convert bytes of encoded length of input into hex format.
    3- Convert encoded input itself into hex format.
    4- Concat All values into one string.
    """
    encoded_tag = bytes(tag).hex()
    if type(input) is str:
        encoded_length = bytes([len(input.encode('utf-8'))]).hex()
        encoded_value = input.encode('utf-8').hex()
    else:
        encoded_length = bytes([len(str(input).encode('utf-8'))]).hex()
        encoded_value = str(input).encode('utf-8').hex()
    return encoded_tag + encoded_length + encoded_value


def format_date(date: str, time: str) -> str:
    """
    Format date & time into UTC format something like : " 2021-12-13T10:39:15Z"
    """
    posting_date = getdate(date)
    time = get_time(time)
    combined_datetime = datetime.datetime.combine(posting_date, time)
    combined_utc = combined_datetime.astimezone(datetime.timezone.utc)
    time_stamp = combined_utc.strftime('%Y-%m-%dT%H:%M:%SZ')
    return time_stamp


def generate_qrcode(data: str) -> str:
    if not data:
        return None
    qr = pyqrcode.create(data)
    with BytesIO() as buffer:
        qr.png(buffer, scale=7)
        buffer.seek(0)
        img_str = base64.b64encode(buffer.getvalue()).decode('utf-8')
        return img_str


def get_phase_2_print_format_details(sales_invoice: SalesInvoice | POSInvoice) -> dict | None:
    settings_id = frappe.db.exists(
        'ZATCA Business Settings', {'company': sales_invoice.company, 'enable_zatca_integration': True}
    )
    if not settings_id:
        return None

    branch_doc = None
    has_branch_address = False
    settings = cast(ZATCABusinessSettings, frappe.get_doc('ZATCA Business Settings', settings_id))
    if settings.enable_branch_configuration:
        if sales_invoice.branch:
            branch_doc = cast(Branch, frappe.get_doc('Branch', sales_invoice.branch))
            if branch_doc.custom_company_address:
                has_branch_address = True
    seller_other_id, seller_other_id_name = get_seller_other_id(sales_invoice, settings)
    buyer_other_id, buyer_other_id_name = get_buyer_other_id(sales_invoice.customer)
    siaf = frappe.get_last_doc('Sales Invoice Additional Fields', {'sales_invoice': sales_invoice.name})

    qr_code = getattr(siaf, "qr_code", None)
    qr_image_src = getattr(siaf, "qr_image_src", None)

    qr_raster_escpos = None
    qr_raster_alt = None
    qr_raster_img = None
    generate_qr_raster_1_result = None

    if qr_code:
        try:
            # Log QR text for debugging
            frappe.logger().debug(f"QR Code Text: {qr_code[:50]}... (length: {len(qr_code)})")

            # Try primary method
            qr_raster_escpos = generate_qr_escpos(qr_code, size=6, error_correction='M')
            
            # If primary method returns None, try alternative
            # if not siaf.qr_raster:
            #     frappe.logger().debug("Trying alternative QR format")
            qr_raster_alt = generate_qr_escpos_alternative(qr_code, size=6)
            generate_qr_raster_1_result = generate_qr_raster_1(qr_image_src, size=200)

            # if siaf.qr_raste:
            #     frappe.logger().debug(f"QR Raster generated: {len(siaf.qr_raster)} bytes")
            # else:
            #     frappe.logger().error("QR Raster generation failed")
                
        except Exception as e:
            frappe.log_error(
                message=f"Error: {str(e)}\n\n{frappe.get_traceback()}",
                title=f"ZATCA QR Raster Error – {sales_invoice.name}"
            )
            siaf.qr_raster = 'Error'
    else:
        frappe.logger().warning("No QR code found in siaf")
        siaf.qr_raster = None 

    return {
        'settings': settings,
        'address': {
            'street': branch_doc.custom_street if has_branch_address else settings.street,
            'district': branch_doc.custom_district if has_branch_address else settings.district,
            'city': branch_doc.custom_city if has_branch_address else settings.city,
            'postal_code': branch_doc.custom_postal_code if has_branch_address else settings.postal_code,
        },
        'seller_other_id': seller_other_id,
        'seller_other_id_name': seller_other_id_name,
        'buyer_other_id': buyer_other_id,
        'buyer_other_id_name': buyer_other_id_name,
        'siaf': siaf,
        'qr_raster_img': qr_raster_img,
        'qr_raster_escpos': qr_raster_escpos,
        'qr_raster_alt': qr_raster_alt,
        'generate_qr_raster_1_result': generate_qr_raster_1_result,
    }


def generate_qr_escpos(qr_text, size=8, error_correction='M'):
    """
    Generate ESC/POS QR code for Shreyans 80mm printer
    
    Args:
        qr_text: Text to encode in QR
        size: Module size (6-10 recommended for 80mm)
        error_correction: 'L', 'M', 'Q', 'H'
    
    Returns:
        ESC/POS command string or None
    """
    try:
        if not qr_text:
            frappe.logger().warning("QR text is empty")
            return None
        
        # Error correction levels
        ec_levels = {'L': 48, 'M': 49, 'Q': 50, 'H': 51}
        ec = ec_levels.get(error_correction, 49)
        
        # Validate size for 80mm (optimal: 6-10)
        if size < 1:
            size = 1
        elif size > 16:
            size = 10
        
        # Encode text
        qr_bytes = qr_text.encode('utf-8')
        text_len = len(qr_bytes)
        
        # Calculate length bytes
        total_len = text_len + 3
        pL = total_len % 256
        pH = total_len // 256
        
        frappe.logger().info(f"Generating QR: text_len={text_len}, size={size}, ec={error_correction}")
        
        cmd = bytearray()
        
        # Center alignment for QR
        cmd += bytes([0x1b, 0x61, 0x01])  # ESC a 1
        
        # 1. Select QR model (Model 2 - most common)
        cmd += bytes([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
        
        # 2. Set module size
        cmd += bytes([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size])
        
        # 3. Set error correction level
        cmd += bytes([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ec])
        
        # 4. Store QR data
        cmd += bytes([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30])
        cmd += qr_bytes
        
        # 5. Print QR code
        cmd += bytes([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])
        
        # Reset alignment to left
        cmd += bytes([0x1b, 0x61, 0x00])  # ESC a 0
        
        # Line feeds
        cmd += bytes([0x0a])
        
        result = cmd.decode('latin-1')
        frappe.logger().info(f"QR command generated: {len(result)} bytes")
        
        return result
        
    except Exception as e:
        frappe.log_error(
            message=f"QR Generation Error: {str(e)}\n{frappe.get_traceback()}",
            title="QR ESC/POS Error"
        )
        return None

# Alternative function for printers that don't support native QR
def generate_qr_escpos_alternative(qr_text, size=6):
    """
    Alternative QR command format for different printer models
    """
    try:
        qr_bytes = qr_text.encode('utf-8')
        text_len = len(qr_bytes)
        
        # Calculate length bytes
        pL = (text_len + 3) % 256
        pH = (text_len + 3) // 256
        
        cmd = bytearray()
        
        # Alternative command sequence (some Epson/Star printers)
        cmd += bytes([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size])  # Size
        cmd += bytes([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30])  # Error correction
        cmd += bytes([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30])      # Store data
        cmd += qr_bytes
        cmd += bytes([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])  # Print
        cmd += bytes([0x0a])
        
        return cmd.decode('latin-1')
        
    except Exception as e:
        frappe.log_error(
            message=f"QR Alt Generation Error: {str(e)}",
            title="QR Alternative Generation Failed"
        )
        return None

def generate_qr_raster(qr_image_src, size=200):
    """
    Convert QR image to ESC/POS raster format for POS80-2
    This method works with ALL thermal printers
    """
    try:
        if not qr_image_src or not qr_image_src.startswith("data:image"):
            frappe.logger().warning("Invalid QR image source")
            return None
        
        # Validate size for 80mm
        if size < 120:
            size = 120
        elif size > 280:
            size = 240
        
        # Round to multiple of 8
        size = (size // 8) * 8
        
        frappe.logger().info(f"Generating QR raster: size={size}x{size}")
        
        # Extract base64
        b64_part = qr_image_src.split(",", 1)[1]
        png_bytes = base64.b64decode(b64_part)
        
        # Open and convert image
        img = Image.open(BytesIO(png_bytes)).convert("1")  # 1-bit monochrome
        img = img.resize((size, size), Image.LANCZOS)
        
        # Build raster
        w = size // 8  # bytes per line
        h = size
        pL = w % 256
        pH = w // 256
        hL = h % 256
        hH = h // 256
        
        raster = bytearray()
        for y in range(h):
            line = 0
            for x in range(size):
                # In mode "1": 0 = black, 255 = white
                if img.getpixel((x, y)) == 0:
                    line |= (0x80 >> (x % 8))
                if (x % 8) == 7:
                    raster.append(line)
                    line = 0
        
        cmd = bytearray()
        
        # Center alignment
        cmd += bytes([0x1b, 0x61, 0x01])  # ESC a 1
        
        # GS v 0 - Print raster bitmap
        cmd += bytes([0x1d, 0x76, 0x30, 0x00, pL, pH, hL, hH])
        cmd += bytes(raster)
        
        # Reset alignment
        cmd += bytes([0x1b, 0x61, 0x00])  # ESC a 0
        cmd += bytes([0x0a])  # Line feed
        
        result = cmd.decode('latin-1')
        frappe.logger().info(f"✅ QR raster generated: {len(result)} bytes")
        
        return result
        
    except Exception as e:
        frappe.log_error(
            message=f"QR Raster Error: {str(e)}\n{frappe.get_traceback()}",
            title="QR Raster Generation Failed"
        )
        return 'not okay'

def generate_qr_raster_1(qr_image_src: str, size: int = 200, center: bool = True) -> bytes | None:
    """
    Convert a base64-encoded QR code image (data URI) to ESC/POS raster format.
    Works with all ESC/POS thermal printers (80mm, POS80-2, etc.).

    Args:
        qr_image_src: Data URI like "data:image/png;base64,..."
        size: Target width/height in pixels (min 120, max 576, multiple of 8)
        center: Whether to center the QR code on the receipt

    Returns:
        bytes: ESC/POS command sequence ready to send to printer
        None: on error
    """
    try:
        # --- 1. Validate input ---
        if not qr_image_src or not qr_image_src.startswith("data:image"):
            frappe.logger().warning("Invalid QR image source: missing data:image prefix")
            return None

        # --- 2. Size constraints (80mm paper = ~576 dots max) ---
        if size < 120:
            size = 120
        elif size > 576:
            size = 576
        # Round down to nearest multiple of 8
        size = (size // 8) * 8
        if size == 0:
            frappe.logger().warning("Size rounded to 0, forcing 120")
            size = 120

        frappe.logger().info(f"Generating QR raster: {size}x{size} px")

        # --- 3. Decode base64 image ---
        try:
            b64_part = qr_image_src.split(",", 1)[1]
            img_data = base64.b64decode(b64_part)
        except (IndexError, base64.binascii.Error) as e:
            frappe.logger().warning(f"Base64 decode failed: {e}")
            return None

        # --- 4. Open and convert to 1-bit ---
        try:
            img = Image.open(BytesIO(img_data))
            if img.format not in ("PNG", "JPEG", "BMP", "GIF"):
                frappe.logger().warning(f"Unsupported image format: {img.format}")
                return None
            img = img.convert("1")  # 1-bit black/white
        except Exception as e:
            frappe.logger().warning(f"PIL image processing failed: {e}")
            return None

        # --- 5. Resize ---
        img = img.resize((size, size), Image.LANCZOS)

        # --- 6. Build raster bitstream ---
        bytes_per_line = size // 8
        raster = bytearray()

        for y in range(size):
            line = 0
            for x in range(size):
                # In mode "1": 0 = black, 255 = white
                if img.getpixel((x, y)) == 0:
                    bit_pos = x % 8
                    line |= (0x80 >> bit_pos)
                # Every 8 pixels → write byte
                if bit_pos == 7:
                    raster.append(line)
                    line = 0
            # If line not full (size not multiple of 8? → already handled by //8)
            # But in case of future changes:
            if size % 8 != 0:
                raster.append(line)

        # --- 7. ESC/POS command: GS v 0 m xL xH yL yH <data> ---
        pL = bytes_per_line % 256
        pH = bytes_per_line // 256
        hL = size % 256
        hH = size // 256

        cmd = bytearray()

        # Optional: Center alignment
        if center:
            cmd += b"\x1b\x61\x01"  # ESC a 1

        # GS v 0 mode (normal density)
        cmd += bytes([0x1D, 0x76, 0x30, 0x00, pL, pH, hL, hH])
        cmd += raster

        # Reset alignment + line feed
        cmd += b"\x1b\x61\x00"  # ESC a 0
        cmd += b"\x0A"         # LF

        frappe.logger().info(f"QR raster generated: {len(cmd)} bytes")
        return cmd  # ← Return **bytes**, not string!

    except Exception as e:
        frappe.log_error(
            message=f"QR Raster Error: {str(e)}\n{frappe.get_traceback()}",
            title="QR Raster Generation Failed"
        )
        return None

def get_seller_other_id(sales_invoice: SalesInvoice | POSInvoice, settings: ZATCABusinessSettings) -> tuple:
    seller_other_ids = ['CRN', 'MOM', 'MLS', '700', 'SAG', 'OTH']
    seller_other_id, seller_other_id_name = None, None
    if settings.enable_branch_configuration:
        if sales_invoice.branch:
            seller_other_id = frappe.get_value(
                'Additional Seller IDs', {'parent': sales_invoice.branch, 'type_code': 'CRN'}, 'value'
            )
    if not seller_other_id:
        for other_id in seller_other_ids:
            seller_other_id = frappe.get_value(
                'Additional Seller IDs', {'parent': settings.name, 'type_code': other_id}, 'value'
            )
            seller_other_id = seller_other_id.strip() or None if isinstance(seller_other_id, str) else seller_other_id
            if seller_other_id and seller_other_id != 'CRN':
                seller_other_id_name = frappe.get_value(
                    'Additional Seller IDs', {'parent': settings.name, 'type_code': other_id}, 'type_name'
                )
                break
    return seller_other_id, seller_other_id_name or 'Commercial Registration Number'


def get_buyer_other_id(customer: str) -> tuple:
    buyer_other_ids = ['TIN', 'CRN', 'MOM', 'MLS', '700', 'SAG', 'NAT', 'GCC', 'IQA', 'PAS', 'OTH']
    buyer_other_id, buyer_other_id_name = None, None
    for other_id in buyer_other_ids:
        buyer_other_id = frappe.get_value('Additional Buyer IDs', {'parent': customer, 'type_code': other_id}, 'value')
        buyer_other_id = buyer_other_id.strip() or None if isinstance(buyer_other_id, str) else buyer_other_id
        if buyer_other_id and buyer_other_id != 'CRN':
            buyer_other_id_name = frappe.get_value(
                'Additional Buyer IDs', {'parent': customer, 'type_code': other_id}, 'type_name'
            )
            break
    return buyer_other_id, buyer_other_id_name or 'Commercial Registration Number'
