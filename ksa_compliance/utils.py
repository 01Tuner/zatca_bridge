import frappe
from frappe.model.document import Document


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


def before_request():
    """Hook that runs before every request to handle Tauri login redirects"""
    
    # Check if this is a Tauri app request
    user_agent = frappe.get_request_header("User-Agent", "")
    is_tauri = "tauri" in user_agent.lower() or frappe.get_request_header("X-Tauri-App")
    
    # Get the current path
    path = frappe.request.path if frappe.request else ""
    
    # If Tauri is accessing /login, redirect to Thunder login
    if is_tauri and path == "/login":
        frappe.local.flags.redirect_location = "/thunder_login"
        raise frappe.Redirect
    
    # If Tauri is accessing root and not logged in, redirect to Thunder login
    if is_tauri and path == "/" and frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/thunder_login"
        raise frappe.Redirect
