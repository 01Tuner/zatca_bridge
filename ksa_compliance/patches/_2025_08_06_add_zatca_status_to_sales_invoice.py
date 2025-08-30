import frappe


def execute():
    """Add ZATCA Status custom field to Sales Invoice and POS Invoice list view."""
    
    # List of doctypes to update
    doctypes = ['Sales Invoice', 'POS Invoice']
    
    for doctype in doctypes:
        custom_field_name = f'{doctype}-custom_zatca_status'
        
        # Check if the custom field already exists
        if frappe.db.exists('Custom Field', custom_field_name):
            print(f'ZATCA Status custom field for {doctype} already exists, skipping...')
            continue
        
        print(f'Adding ZATCA Status custom field to {doctype}')
        
        # Create the custom field
        custom_field = frappe.get_doc({
            'doctype': 'Custom Field',
            'dt': doctype,
            'fieldname': 'custom_zatca_status',
            'fieldtype': 'Data',
            'label': 'ZATCA Status',
            'insert_after': 'status',
            'read_only': 1,
            'in_list_view': 1,
            'in_standard_filter': 1,
            'allow_on_submit': 1,
            'no_copy': 1,
            'translatable': 0,
            'description': 'ZATCA Integration Status from Sales Invoice Additional Fields'
        })
        
        custom_field.insert(ignore_permissions=True)
        print(f'Created custom field: {custom_field.name}')
    
    # Update existing invoices with ZATCA status
    for doctype in doctypes:
        print(f'Updating existing {doctype}s with ZATCA status...')
        
        # Get all invoices that have corresponding Sales Invoice Additional Fields
        invoices_with_status = frappe.db.sql(f"""
            SELECT 
                si.name as invoice_name,
                siaf.integration_status
            FROM 
                `tab{doctype}` si
            INNER JOIN 
                `tabSales Invoice Additional Fields` siaf 
                ON si.name = siaf.sales_invoice 
                AND siaf.invoice_doctype = %s
                AND siaf.is_latest = 1
            WHERE 
                siaf.integration_status IS NOT NULL 
                AND siaf.integration_status != ''
        """, (doctype,), as_dict=True)
        
        # Update each invoice with its ZATCA status
        for invoice in invoices_with_status:
            frappe.db.set_value(
                doctype, 
                invoice.invoice_name, 
                'custom_zatca_status', 
                invoice.integration_status,
                update_modified=False
            )
        
        print(f'Updated {len(invoices_with_status)} {doctype}s with ZATCA status')
    
    # Commit the changes
    frappe.db.commit()
    print('ZATCA Status custom field added successfully for both Sales Invoice and POS Invoice!')
