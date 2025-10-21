import frappe
from frappe.model.document import Document
from ksa_compliance.ksa_compliance.doctype.sales_invoice_additional_fields.sales_invoice_additional_fields import ZatcaSendMode


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
    
    # Update the Sales Invoice with the ZATCA status
    try:
        frappe.db.set_value(
            doc.invoice_doctype,
            doc.sales_invoice,
            'custom_zatca_status',
            integration_status,
            update_modified=False
        )
        frappe.db.commit()
    except Exception as e:
        frappe.log_error(
            message=f"Failed to update ZATCA status for {doc.invoice_doctype} {doc.sales_invoice}: {str(e)}",
            title="ZATCA Status Update Error"
        )
