import frappe
from frappe.model.document import Document
from ksa_compliance.ksa_compliance.doctype.sales_invoice_additional_fields.sales_invoice_additional_fields import ZatcaSendMode


def assign_qr_code_to_invoice(invoice_name: str, image_url: str) -> str:
    """Creates or updates a ZATCA QR Code document for a sales invoice, and returns its name."""
    if not image_url:
        return None
    
    qr_doc_name = f"QR-{invoice_name}"
    
    if not frappe.db.exists("ZATCA QR Code", qr_doc_name):
        doc = frappe.get_doc({
            "doctype": "ZATCA QR Code",
            "sales_invoice": invoice_name,
            "qr_image": image_url
        })
        doc.insert(ignore_permissions=True)
    else:
        frappe.db.set_value("ZATCA QR Code", qr_doc_name, "qr_image", image_url)
        
    return qr_doc_name

def update_zatca_status_in_sales_invoice(doc: Document, method=None):
    """
    Update the ZATCA status in the related Sales Invoice whenever 
    Sales Invoice Additional Fields is created/updated.
    """
    if not hasattr(doc, 'sales_invoice') or not doc.sales_invoice:
        return
    
    if not hasattr(doc, 'invoice_doctype') or not doc.invoice_doctype:
        return
    
    # Only update if this is the latest additional fields record
    if hasattr(doc, 'is_latest') and not doc.is_latest:
        return
    
    # Skip commit during compliance checks to avoid interfering with savepoints
    if getattr(doc, 'send_mode', None) == ZatcaSendMode.Compliance:
        return

    # Get the integration status
    integration_status = getattr(doc, 'integration_status', '')
    
    # Update the Sales Invoice with the ZATCA status and QR
    try:
        update_dict = {
            'custom_zatca_status': integration_status
        }
        if hasattr(doc, 'qr_image_src') and doc.qr_image_src:
            qr_src = doc.qr_image_src
            if qr_src.startswith('data:image'):
                import base64
                from frappe.utils.file_manager import save_file
                try:
                    b64_str = qr_src.split(',')[1] if ',' in qr_src else qr_src
                    file_doc = save_file(
                        fname=f"ZATCA_Phase2_QR_{doc.sales_invoice.replace('/', '-')}.png",
                        content=base64.b64decode(b64_str),
                        dt=None,
                        dn=None,
                        is_private=0
                    )
                    update_dict['custom_zatca_qr_code'] = assign_qr_code_to_invoice(doc.sales_invoice, file_doc.file_url)
                except Exception as e:
                    frappe.log_error(title="Failed to save Phase 2 QR as file", message=str(e))
                    update_dict['custom_zatca_qr_code'] = assign_qr_code_to_invoice(doc.sales_invoice, qr_src)
            else:
                update_dict['custom_zatca_qr_code'] = assign_qr_code_to_invoice(doc.sales_invoice, qr_src)
            
        frappe.db.set_value(
            doc.invoice_doctype,
            doc.sales_invoice,
            update_dict,
            update_modified=False
        )
        frappe.db.commit()
    except Exception as e:
        frappe.log_error(
            message=f"Failed to update ZATCA status for {doc.invoice_doctype} {doc.sales_invoice}: {str(e)}",
            title="ZATCA Status Update Error"
        )
