import frappe
from frappe import _

def get_context(context):
    """Override default login page for Tauri"""
    
    # Check if user is already logged in
    if frappe.session.user != "Guest":
        frappe.local.flags.redirect_location = "/app/point-of-sale"
        raise frappe.Redirect
    
    # Check if this is a Tauri request by looking for Tauri user agent or custom headers
    user_agent = frappe.get_request_header("User-Agent", "")
    is_tauri = "tauri" in user_agent.lower() or frappe.get_request_header("X-Tauri-App")
    
    # For Tauri requests, redirect to Thunder login
    if is_tauri:
        frappe.local.flags.redirect_location = "/thunder_login"
        raise frappe.Redirect
    
    # For web requests, use default Frappe login
    # Import and call the original Frappe login context
    from frappe.www.login import get_context as frappe_login_context
    return frappe_login_context(context)