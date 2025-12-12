frappe.ui.form.on("POS Invoice", {
  refresh: function (frm) {
    if (frm.doc.custom_zatca_status) {
      update_zatca_indicator(frm);
      // Add E-invoice Details button
      frm.add_custom_button(
        __("E-invoice Details"),
        function () {
          show_einvoice_dialog(frm, "POS Invoice");
        },
        __("View")
      );
    }

    // Poll for ZATCA status if submitted but status is missing OR it is just 'Ready For Batch'
    if (frm.doc.docstatus === 1 && (!frm.doc.custom_zatca_status || frm.doc.custom_zatca_status === "Ready For Batch")) {
      poll_zatca_status(frm);
    }

    // Add Fix Rejection button if status is Rejected
    if (frm.doc.custom_zatca_status === "Rejected") {
      frm.add_custom_button(__("Fix Rejection"), () => fix_rejection_from_invoice(frm), null, "primary");
    }
  },
});


function update_zatca_indicator(frm) {
  // Only proceed if the document exists and isn't new
  if (!frm || !frm.doc || frm.is_new()) return;

  // Remove any previously injected ZATCA pill
  try {
    const $head = $(frm.page.wrapper).find(".page-head");
    $head.find('[data-zatca-indicator="1"]').remove();
  } catch (e) { }

  const status = frm.doc.custom_zatca_status;
  if (!status) return;

  // Set the appropriate color based on the status
  let color = "blue";
  switch (status) {
    case "Rejected":
      color = "red";
      break;
    case "Accepted with warnings":
    case "Resend":
      color = "orange";
      break;
    case "Clearance switched off":
      color = "grey";
      break;
    case "Accepted":
    default:
      color = "blue";
  }

  // Create the indicator with a label
  const label = `${__("ZATCA")}: ${__(status)}`;
  const $pill = $(
    `<span class="indicator-pill no-indicator-dot whitespace-nowrap ${color}" data-zatca-indicator="1"><span>${label}</span></span>`
  );

  // Add the indicator to the page header
  const $head = $(frm.page.wrapper).find(".page-head");
  console.log($head);
  if ($head.find(".indicator-pill").length) {
    $head.find(".indicator-pill").last().after($pill);
  } else if (frm.page.indicator && $(frm.page.indicator).length) {
    $(frm.page.indicator).after($pill);
  } else if ($head.find(".page-title").length) {
    $head.find(".page-title").after($pill);
  } else {
    $(frm.page.wrapper).prepend($pill);
  }
}

function show_einvoice_dialog(frm, doctype) {
  // Get Sales Invoice Additional Fields data
  frappe.call({
    method: "frappe.client.get_list",
    args: {
      doctype: "Sales Invoice Additional Fields",
      filters: {
        sales_invoice: frm.doc.name,
        invoice_doctype: doctype,
        is_latest: 1,
      },
      fields: ["*"],
      limit: 1,
    },
    callback: function (r) {
      if (r.message && r.message.length > 0) {
        let einvoice_data = r.message[0];
        frappe.set_route("Form", "Sales Invoice Additional Fields", einvoice_data.name);
      } else {
        frappe.msgprint(__("No E-invoice data found for this invoice."));
      }
    },
  });
}



function poll_zatca_status(frm, attempt = 1) {
  const MAX_ATTEMPTS = 60;
  const INTERVAL = 2000; // 2 seconds

  if (attempt > MAX_ATTEMPTS) {
    console.log("Stopped polling for ZATCA status: Max attempts reached.");
    return;
  }

  // Check if we already have a FINAL status.
  // If it is "Ready For Batch", we should continue polling.
  if (frm.doc.custom_zatca_status && frm.doc.custom_zatca_status !== "Ready For Batch") {
    return;
  }

  frappe.call({
    method: "ksa_compliance.ksa_compliance.doctype.sales_invoice_additional_fields.sales_invoice_additional_fields.get_zatca_integration_status",
    args: {
      invoice_id: frm.doc.name,
      doctype: frm.doc.doctype
    },
    callback: function (r) {
      // The python method sets frappe.response['integration_status'], so it comes at the root of r
      const status = r.integration_status || (r.message && r.message.integration_status);
      console.log(`[Attempt ${attempt}] Polling ZATCA Status:`, status, r);

      if (status) {
        // Always update the UI with the latest status we found
        frm.doc.custom_zatca_status = status;
        update_zatca_indicator(frm);

        // If it is a final status (NOT Ready For Batch), we show alerts and buttons, then stop polling.
        if (status !== "Ready For Batch") {
          if (status === "Rejected") {
            frm.add_custom_button(__("Fix Rejection"), () => fix_rejection_from_invoice(frm), null, "primary");
          }

          let indicator_color = 'blue';
          if (status === 'Accepted') indicator_color = 'green';
          else if (status === 'Rejected') indicator_color = 'red';
          else if (status === 'Accepted with warnings') indicator_color = 'orange';

          frappe.show_alert({
            message: __("ZATCA Status Updated: {0}", [status]),
            indicator: indicator_color
          });
          return; // Stop polling
        }
      }

      // If we are here, it means:
      // 1. No status yet.
      // 2. Status is "Ready For Batch" (UI updated above, but we keep polling).
      setTimeout(() => poll_zatca_status(frm, attempt + 1), INTERVAL);
    }
  });
}

async function fix_rejection_from_invoice(frm) {
  // Fetch the latest Sales Invoice Additional Fields doc name
  let siaf_id = await frappe.db.get_value("Sales Invoice Additional Fields", {
    sales_invoice: frm.doc.name,
    invoice_doctype: frm.doc.doctype,
    is_latest: 1
  }, "name");

  // Handle the response structure from frappe.db.get_value which returns {message: {name: "..."}}
  if (siaf_id && siaf_id.message) {
    siaf_id = siaf_id.message.name;
  }


  if (!siaf_id) {
    frappe.msgprint(__("Could not find the latest ZATCA document to fix."));
    return;
  }

  let message = __("<p>This will create a new Sales Invoice Additional Fields document for the invoice '{0}' and " +
    "submit it to ZATCA. <strong>Make sure you have updated any bad configuration that lead to the initial rejection</strong>.</p>" +
    "<p>Do you want to proceed?</p>", [frm.doc.name]);

  frappe.confirm(message, async () => {
    try {
      await frappe.call({
        freeze: true,
        freeze_message: __('Please wait...'),
        method: "ksa_compliance.ksa_compliance.doctype.sales_invoice_additional_fields.sales_invoice_additional_fields.fix_rejection",
        args: {
          id: siaf_id,
        },
      });
      frm.reload_doc();
    } catch (e) {
      console.error(e);
    }
  });
}