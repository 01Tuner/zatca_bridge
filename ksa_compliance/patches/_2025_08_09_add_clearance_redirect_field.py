"""
Add clearance_redirect field to Sales Invoice Additional Fields
and initialize existing records
"""

import frappe


def execute():
    """Initialize clearance_redirect field for existing Sales Invoice Additional Fields records"""
    
    # Check if the field exists in the database
    if not frappe.db.has_column('Sales Invoice Additional Fields', 'clearance_redirect'):
        # Field will be added automatically by the DocType migration
        return
    
    # Initialize all existing records to have clearance_redirect = 0 (False)
    # This ensures existing records work correctly with the new logic
    frappe.db.sql("""
        UPDATE `tabSales Invoice Additional Fields`
        SET clearance_redirect = 0
        WHERE clearance_redirect IS NULL
    """)
    
    frappe.db.commit()
    
    print("Initialized clearance_redirect field for existing Sales Invoice Additional Fields records")
