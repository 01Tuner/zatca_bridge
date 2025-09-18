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
    
  },
});


function update_zatca_indicator(frm) {
  // Only proceed if the document exists and isn't new
  if (!frm || !frm.doc || frm.is_new()) return;

  // Remove any previously injected ZATCA pill
  try {
    const $head = $(frm.page.wrapper).find(".page-head");
    $head.find('[data-zatca-indicator="1"]').remove();
  } catch (e) {}

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
        show_einvoice_details_dialog(einvoice_data, frm.doc.name);
      } else {
        frappe.msgprint(__("No E-invoice data found for this invoice."));
      }
    },
  });
}

function show_einvoice_details_dialog(data, invoice_name) {
  let dialog = new frappe.ui.Dialog({
    title: __("E-invoice Details for {0}", [invoice_name]),
    size: "extra-large",
    fields: [
      {
        fieldtype: "HTML",
        fieldname: "additional_fields_link",
        options: `<div style="margin-bottom: 15px;">
                    <strong>Additional Fields Document: </strong>
                    <a href="#Form/Sales Invoice Additional Fields/${data.name}" 
                       onclick="frappe.set_route('Form', 'Sales Invoice Additional Fields', '${data.name}'); return false;"
                       style="color: #007bff; text-decoration: underline;">
                        ${data.name}
                    </a>
                </div>`,
      },
      {
        fieldtype: "HTML",
        fieldname: "document_container",
        options: `<div id="embedded-document-container" style="min-height: 600px;"></div>`,
      },
    ],
    primary_action_label: __("Open in New Tab"),
    primary_action: function () {
      frappe.set_route("Form", "Sales Invoice Additional Fields", data.name);
    },
    secondary_action_label: __("Close"),
    secondary_action: function () {
      dialog.hide();
    },
  });

  dialog.show();

  // Load and render the document form in the dialog
  setTimeout(() => {
    load_embedded_document(data.name);
  }, 500);
}

function show_einvoice_details_dialog(data, invoice_name) {
  let dialog = new frappe.ui.Dialog({
    title: __("E-invoice Details for {0}", [invoice_name]),
    size: "extra-large",
    fields: [
      // {
      //     fieldtype: 'HTML',
      //     fieldname: 'additional_fields_link',
      //     options: `<div style="margin-bottom: 15px;">
      //         <strong>Additional Fields Document: </strong>
      //         <a href="#Form/Sales Invoice Additional Fields/${data.name}"
      //            onclick="frappe.set_route('Form', 'Sales Invoice Additional Fields', '${data.name}'); return false;"
      //            style="color: #007bff; text-decoration: underline;">
      //             ${data.name}
      //         </a>
      //     </div>`
      // },
      {
        fieldtype: "HTML",
        fieldname: "document_container",
        options: `<div id="embedded-document-container" style="min-height: 700px;">
                    <div class="loading-indicator" style="text-align: center; padding: 50px; color: #888;">
                        <i class="fa fa-spinner fa-spin" style="font-size: 24px;"></i><br><br>
                        Loading document...
                    </div>
                </div>`,
      },
    ],
    primary_action_label: __("Open in New Tab"),
    primary_action: function () {
      frappe.set_route("Form", "Sales Invoice Additional Fields", data.name);
    },
    secondary_action_label: __("Close"),
    secondary_action: function () {
      dialog.hide();
    },
  });

  dialog.show();

  // Load and render the document form in the dialog
  setTimeout(() => {
    load_embedded_document_form(data.name);
  }, 500);
}

function load_embedded_document_form(doc_name) {
  // Alternative Method 2: Embed using Frappe's form rendering
  // This creates the actual form widget within the dialog
  const container = document.getElementById("embedded-document-container");
  if (!container) return;

  frappe.model.with_doc(
    "Sales Invoice Additional Fields",
    doc_name,
    function () {
      const doc = frappe.get_doc("Sales Invoice Additional Fields", doc_name);

      // Clear container
      // container.innerHTML = '';

      // Create form wrapper
      const form_wrapper = $(
        `<div class="embedded-form-wrapper" style="background: white;"></div>`
      ).appendTo(container);
      form_wrapper.hide();
      // Create a simplified form view
      frappe.model.with_doctype("Sales Invoice Additional Fields", function () {
        const form = new frappe.ui.form.Form(
          "Sales Invoice Additional Fields",
          form_wrapper[0],
          false
        );

        // Set the document
        form.doc = doc;
        form.docname = doc_name;
        form.doctype = "Sales Invoice Additional Fields";

        // Refresh the form to display all fields
        form.refresh();

        // Make form read-only after a short delay to ensure it's fully loaded
        setTimeout(() => {
          form.disable_form();

          form_wrapper.find(".form-toolbar").hide();
          form_wrapper.find(".layout-side-section").hide();
          form_wrapper.find(".page-head").hide();
          form_wrapper.find(".form-footer").hide();
          form_wrapper.find(".form-assignments").hide();
          form_wrapper.find(".form-comments").hide();
          form_wrapper.find(".form-shared").hide();
          form_wrapper.find(".form-attachments").hide();

          // Hide form actions and buttons
          form_wrapper.find(".btn-primary").hide();
          form_wrapper.find(".btn-secondary").hide();
          form_wrapper.find(".form-print-wrapper").hide();

          // Add some styling
          form_wrapper.find(".form-layout").css({
            "max-height": "600px",
            "overflow-y": "auto",
            // 'border': '1px solid #d1d8dd',
            // 'border-radius': '4px',
            // 'padding': '15px'
          });
          form_wrapper.find(".form-layout .form-page").css({
            "padding-left": "20px",
            "padding-top": "20px",
          });

          $(container).find(".loading-indicator").remove();
          form_wrapper.show();
        }, 1000);
      });
    }
  );
}