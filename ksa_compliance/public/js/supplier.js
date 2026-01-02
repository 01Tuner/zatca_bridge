frappe.ui.form.on("Supplier", {
    validate: function (frm) {
        if (frm.doc.tax_id) {
            // Validate Tax ID: 15 digits, starts with 3, ends with 3
            const tax_id = frm.doc.tax_id;
            const regex = /^3\d{13}3$/;
            if (!regex.test(tax_id)) {
                frappe.msgprint(__("Tax ID must be 15 digits long, starting and ending with '3'"));
                frappe.validated = false;
            }
        }
    },
});
