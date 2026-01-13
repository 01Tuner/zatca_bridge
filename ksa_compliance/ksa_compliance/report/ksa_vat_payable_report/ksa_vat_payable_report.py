# Copyright (c) 2024, rafeeq and contributors
# For license information, please see license.txt

import frappe
from frappe import _
import json

def execute(filters=None):
	columns = get_columns(filters)
	data = get_data(filters)
	return columns, data

def get_columns(filters):
	currency = "SAR"
	if filters and filters.get("company"):
		company_currency = frappe.db.get_value("Company", filters.get("company"), "default_currency")
		if company_currency:
			currency = company_currency
	
	return [
		{
			"fieldname": "title",
			"label": _("Title"),
			"fieldtype": "Data",
			"width": 300
		},
		{
			"fieldname": "amount",
			"label": _("Amount ({0})".format(currency)),
			"fieldtype": "Currency",
			"width": 150
		},
		{
			"fieldname": "adjustment",
			"label": _("Adjustment ({0})".format(currency)),
			"fieldtype": "Currency",
			"width": 150
		},
		{
			"fieldname": "vat_amount",
			"label": _("VAT Amount ({0})".format(currency)),
			"fieldtype": "Currency",
			"width": 150
		}
	]

def get_data(filters):
	data = []
	
	# Get Sales Data
	sales_data = get_sales_data(filters)
	
	# Add VAT on Sales header
	data.append({
		"title": _("VAT on Sales"),
		"amount": 0.0,
		"adjustment": 0.0,
		"vat_amount": 0.0,
		"indent": 0
	})
	
	# Add sales categories
	sales_total_amount = 0.0
	sales_total_adjustment = 0.0
	sales_total_vat = 0.0
	
	for row in sales_data:
		data.append(row)
		sales_total_amount += row.get("amount", 0.0)
		sales_total_adjustment += row.get("adjustment", 0.0)
		sales_total_vat += row.get("vat_amount", 0.0)
	
	# Add sales grand total
	data.append({
		"title": _("Grand Total"),
		"amount": sales_total_amount,
		"adjustment": sales_total_adjustment,
		"vat_amount": sales_total_vat,
		"indent": 0,
		"bold": 1
	})
	
	# Add empty row
	data.append({
		"title": "",
		"amount": 0.0,
		"adjustment": 0.0,
		"vat_amount": 0.0
	})
	
	# Get Purchase Data
	purchase_data = get_purchase_data(filters)
	
	# Add VAT on Purchases header
	data.append({
		"title": _("VAT on Purchases"),
		"amount": 0.0,
		"adjustment": 0.0,
		"vat_amount": 0.0,
		"indent": 0
	})
	
	# Add purchase categories
	purchase_total_amount = 0.0
	purchase_total_adjustment = 0.0
	purchase_total_vat = 0.0
	
	for row in purchase_data:
		data.append(row)
		purchase_total_amount += row.get("amount", 0.0)
		purchase_total_adjustment += row.get("adjustment", 0.0)
		purchase_total_vat += row.get("vat_amount", 0.0)
	
	# Add purchase grand total
	data.append({
		"title": _("Grand Total"),
		"amount": purchase_total_amount,
		"adjustment": purchase_total_adjustment,
		"vat_amount": purchase_total_vat,
		"indent": 0,
		"bold": 1
	})
	
	# Add empty row
	data.append({
		"title": "",
		"amount": 0.0,
		"adjustment": 0.0,
		"vat_amount": 0.0
	})
	
	# Add VAT Payable Amount
	vat_payable = sales_total_vat - purchase_total_vat
	data.append({
		"title": _("VAT Payable Amount"),    
		"amount": 0.0,
		"adjustment": 0.0,
		"vat_amount": vat_payable,
		"indent": 0,
		"bold": 1
	})
	
	return data

def get_tax_account_map():
	"""
	Returns a dictionary mapping Account -> ZATCA Category.
	Sources: Item Tax Template (custom_zatca_item_tax_category).
	"""
	account_map = {}
	
	# Fetch Item Tax Templates and their accounts
	# Join Item Tax Template Detail where parent = Item Tax Template
	
	# We want: tax_type (Account) -> custom_zatca_item_tax_category
	
	# 1. Get all Item Tax Templates with their categories
	item_tax_templates = frappe.get_all("Item Tax Template", 
		fields=["name", "custom_zatca_item_tax_category"])
	
	for itt in item_tax_templates:
		category = itt.custom_zatca_item_tax_category or "Standard rate"
		
		# Get Tax Accounts for this template
		taxes = frappe.get_all("Item Tax Template Detail", 
			filters={"parent": itt.name}, 
			fields=["tax_type"])
			
		for tax in taxes:
			# If account is already mapped, earlier mapping might be overwritten. 
			# Assuming consistent mapping.
			account_map[tax.tax_type] = category
            
    # Also fetch Sales/Purchase Taxes and Charges Templates as fallback (Default to Standard)
	# This ensures accounts used in default templates are captured as "Standard rate"
	# if they weren't already mapped to something else.
	
	# Sales Templates
	st_templates = frappe.get_all("Sales Taxes and Charges Template")
	for t in st_templates:
		taxes = frappe.get_all("Sales Taxes and Charges", filters={"parent": t.name}, fields=["account_head"])
		for tax in taxes:
			if tax.account_head not in account_map:
				account_map[tax.account_head] = "Standard rate"
				
	# Purchase Templates
	pt_templates = frappe.get_all("Purchase Taxes and Charges Template")
	for t in pt_templates:
		taxes = frappe.get_all("Purchase Taxes and Charges", filters={"parent": t.name}, fields=["account_head"])
		for tax in taxes:
			if tax.account_head not in account_map:
				account_map[tax.account_head] = "Standard rate"
				
	return account_map

def get_sales_data(filters):
	"""Get sales data grouped by ZATCA category using Account logic for VAT"""
	conditions = get_conditions(filters)
	
	invoices = frappe.get_all("Sales Invoice", 
		filters=conditions, 
		fields=["name"]
	)
	
	invoice_names = [inv.name for inv in invoices]
	
	if not invoice_names:
		return get_empty_sales_categories()
	
	# 1. Calculate Taxable Amounts from Items
	items = frappe.db.sql("""
		SELECT 
			si_item.amount,
			COALESCE(itt.custom_zatca_item_tax_category, 'Standard rate') as zatca_category
		FROM 
			`tabSales Invoice Item` si_item
		LEFT JOIN
			`tabItem Tax Template` itt ON si_item.item_tax_template = itt.name
		WHERE 
			si_item.parent IN %s
	""", (tuple(invoice_names),), as_dict=1)
	
	# 2. Calculate VAT Amounts from GL Entries (Accounts)
	account_map = get_tax_account_map()
	tax_accounts = list(account_map.keys())
	
	gl_entries = []
	if tax_accounts:
		gl_entries = frappe.db.sql("""
			SELECT
				account,
				(credit - debit) as tax_amount
			FROM
				`tabGL Entry`
			WHERE
				voucher_type = 'Sales Invoice'
				AND voucher_no IN %s
				AND account IN %s
				AND is_cancelled = 0
		""", (tuple(invoice_names), tuple(tax_accounts)), as_dict=1)
	
	# Process Totals
	category_totals = {
		"Standard Rated Sales": {"amount": 0.0, "vat": 0.0},
		"Zero Rated Domestic Sales": {"amount": 0.0, "vat": 0.0},
		"Exempted Sales": {"amount": 0.0, "vat": 0.0},
		"Export": {"amount": 0.0, "vat": 0.0}
	}
	
	# Sum Sales Amounts
	for item in items:
		category_key = map_zatca_to_sales_category(item.zatca_category)
		if category_key in category_totals:
			category_totals[category_key]["amount"] += item.get("amount", 0.0)
			
	# Sum VAT Amounts
	for entry in gl_entries:
		category_name = account_map.get(entry.account, "Standard rate")
		category_key = map_zatca_to_sales_category(category_name)
		
		# If account maps to a category key not in our list (rare), ignore or map to standard?
		# existing function map_zatca_to_sales_category handles 'Standard rate' default
		
		if category_key in category_totals:
			category_totals[category_key]["vat"] += entry.get("tax_amount", 0.0)
	
	# Build result
	result = []
	for category in ["Standard Rated Sales", "Zero Rated Domestic Sales", "Exempted Sales", "Export"]:
		result.append({
			"title": _(category),
			"amount": category_totals[category]["amount"],
			"adjustment": 0.0,
			"vat_amount": category_totals[category]["vat"],
			"indent": 1
		})
	
	return result

def get_purchase_data(filters):
	"""Get purchase data grouped by ZATCA category using Account logic for VAT"""
	conditions = get_purchase_conditions(filters)
	
	invoices = frappe.get_all("Purchase Invoice", 
		filters=conditions, 
		fields=["name"]
	)
	
	invoice_names = [inv.name for inv in invoices]
	
	if not invoice_names:
		return get_empty_purchase_categories()
	
	# 1. Calculate Taxable Amounts from Items
	items = frappe.db.sql("""
		SELECT 
			pi_item.amount,
			COALESCE(itt.custom_zatca_item_tax_category, 'Standard rate') as zatca_category
		FROM 
			`tabPurchase Invoice Item` pi_item
		LEFT JOIN
			`tabItem Tax Template` itt ON pi_item.item_tax_template = itt.name
		WHERE 
			pi_item.parent IN %s
	""", (tuple(invoice_names),), as_dict=1)
	
	# 2. Calculate VAT Amounts from GL Entries (Accounts)
	account_map = get_tax_account_map()
	tax_accounts = list(account_map.keys())
	
	gl_entries = []
	if tax_accounts:
		gl_entries = frappe.db.sql("""
			SELECT
				account,
				(debit - credit) as tax_amount
			FROM
				`tabGL Entry`
			WHERE
				voucher_type = 'Purchase Invoice'
				AND voucher_no IN %s
				AND account IN %s
				AND is_cancelled = 0
		""", (tuple(invoice_names), tuple(tax_accounts)), as_dict=1)
	
	# Process Totals
	category_totals = {
		"Standard Rated Domestic Purchase": {"amount": 0.0, "vat": 0.0},
		"Zero Rated Purchase": {"amount": 0.0, "vat": 0.0},
		"Exempted Purchase": {"amount": 0.0, "vat": 0.0}
	}
	
	# Sum Purchase Amounts
	for item in items:
		category_key = map_zatca_to_purchase_category(item.zatca_category)
		if category_key in category_totals:
			category_totals[category_key]["amount"] += item.get("amount", 0.0)
			
	# Sum VAT Amounts
	for entry in gl_entries:
		category_name = account_map.get(entry.account, "Standard rate")
		category_key = map_zatca_to_purchase_category(category_name)
		
		if category_key in category_totals:
			category_totals[category_key]["vat"] += entry.get("tax_amount", 0.0)
	
	# Build result
	result = []
	for category in ["Standard Rated Domestic Purchase", "Zero Rated Purchase", "Exempted Purchase"]:
		result.append({
			"title": _(category),
			"amount": category_totals[category]["amount"],
			"adjustment": 0.0,
			"vat_amount": category_totals[category]["vat"],
			"indent": 1
		})
	
	return result

def map_zatca_to_sales_category(zatca_category):
	"""Map ZATCA category to sales report category"""
	if not zatca_category or zatca_category == "Standard rate":
		return "Standard Rated Sales"
	elif "Zero rated" in zatca_category:
		if "Export" in zatca_category:
			return "Export"
		else:
			return "Zero Rated Domestic Sales"
	elif "Exempt" in zatca_category:
		return "Exempted Sales"
	else:
		return "Standard Rated Sales"

def map_zatca_to_purchase_category(zatca_category):
	"""Map ZATCA category to purchase report category"""
	if not zatca_category or zatca_category == "Standard rate":
		return "Standard Rated Domestic Purchase"
	elif "Zero rated" in zatca_category:
		return "Zero Rated Purchase"
	elif "Exempt" in zatca_category:
		return "Exempted Purchase"
	else:
		return "Standard Rated Domestic Purchase"

def get_empty_sales_categories():
	"""Return empty sales categories"""
	return [
		{"title": _("Standard Rated Sales"), "amount": 0.0, "adjustment": 0.0, "vat_amount": 0.0, "indent": 1},
		{"title": _("Zero Rated Domestic Sales"), "amount": 0.0, "adjustment": 0.0, "vat_amount": 0.0, "indent": 1},
		{"title": _("Exempted Sales"), "amount": 0.0, "adjustment": 0.0, "vat_amount": 0.0, "indent": 1},
		{"title": _("Export"), "amount": 0.0, "adjustment": 0.0, "vat_amount": 0.0, "indent": 1}
	]

def get_empty_purchase_categories():
	"""Return empty purchase categories"""
	return [
		{"title": _("Standard Rated Domestic Purchase"), "amount": 0.0, "adjustment": 0.0, "vat_amount": 0.0, "indent": 1},
		{"title": _("Zero Rated Purchase"), "amount": 0.0, "adjustment": 0.0, "vat_amount": 0.0, "indent": 1},
		{"title": _("Exempted Purchase"), "amount": 0.0, "adjustment": 0.0, "vat_amount": 0.0, "indent": 1}
	]

def get_conditions(filters):
	"""Get conditions for Sales Invoice"""
	conditions = {}
	if filters.get("company"):
		conditions["company"] = filters["company"]
	if filters.get("from_date") and filters.get("to_date"):
		conditions["posting_date"] = ["between", [filters["from_date"], filters["to_date"]]]
	conditions["docstatus"] = 1
	return conditions

def get_purchase_conditions(filters):
	"""Get conditions for Purchase Invoice"""
	conditions = {}
	if filters.get("company"):
		conditions["company"] = filters["company"]
	if filters.get("from_date") and filters.get("to_date"):
		conditions["posting_date"] = ["between", [filters["from_date"], filters["to_date"]]]
	conditions["docstatus"] = 1
	return conditions
