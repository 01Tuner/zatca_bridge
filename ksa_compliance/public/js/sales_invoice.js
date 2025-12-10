frappe.ui.form.on('Sales Invoice', {
  setup: function (frm) {
    frm.set_query('custom_return_against_additional_references', function (doc) {
      // Similar to logic in erpnext/public/js/controllers/transaction.js for return_against
      let filters = {
        'docstatus': 1,
        'is_return': 0,
        'company': doc.company
      };
      if (frm.fields_dict['customer'] && doc.customer) filters['customer'] = doc.customer;
      if (frm.fields_dict['supplier'] && doc.supplier) filters['supplier'] = doc.supplier;

      return {
        filters: filters
      };
    });
  },
  refresh: async function (frm) {
    // await set_zatca_integration_status(frm)
    await set_zatca_discount_reason(frm)

    // Log the current document to the console for debugging
    console.log("ZATCA Status:", frm.doc.custom_zatca_status);

    // Always try to add the E-invoice tab (will show a message if no data)
    add_einvoice_form_tab(frm);

    // Update page title indicator with ZATCA status alongside document status
    setTimeout(() => update_zatca_indicator(frm), 0);

    // Poll for ZATCA status if submitted but status is missing OR it is just 'Ready For Batch'
    if (frm.doc.docstatus === 1 && (!frm.doc.custom_zatca_status || frm.doc.custom_zatca_status === "Ready For Batch")) {
      poll_zatca_status(frm);
    }

    // Add Fix Rejection button if status is Rejected
    if (frm.doc.custom_zatca_status === "Rejected") {
      frm.add_custom_button(__("Fix Rejection"), () => fix_rejection_from_invoice(frm), null, "primary");
    }
  },
})

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
        add_einvoice_form_tab(frm); // Refresh tab if exists

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

async function set_zatca_discount_reason(frm) {
  const zatca_discount_reasons = await get_zatca_discount_reason_codes()
  frm.fields_dict.custom_zatca_discount_reason.set_data(zatca_discount_reasons)
}

async function set_zatca_integration_status(frm) {
  const res = await frappe.call({
    method: "ksa_compliance.ksa_compliance.doctype.sales_invoice_additional_fields.sales_invoice_additional_fields.get_zatca_integration_status",
    args: {
      invoice_id: frm.doc.name,
      doctype: frm.doc.doctype
    },
  });

  const status = res.integration_status;
  if (status) {
    let color = "blue"
    if (status === 'Accepted') {
      color = "green"
    } else if (["Rejected", "Resend"].includes(status)) {
      color = "red"
    }
    frm.set_intro(`<b>Zatca Status: ${status}</b>`, color)
  }
}

async function get_zatca_discount_reason_codes() {
  const res = await frappe.call({
    method: "ksa_compliance.invoice.get_zatca_invoice_discount_reason_list"
  })
  return res.message
}

function update_zatca_indicator(frm) {
  // Remove any previously injected ZATCA pill
  try {
    const $head = $(frm.page.wrapper).find(".page-head");
    $head.find('[data-zatca-indicator="1"]').remove();
  } catch (e) { }

  // Only proceed if the document exists and isn't new
  if (!frm || !frm.doc || frm.is_new()) return;

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

function remove_einvoice_tab(frm) {
  // Remove previously injected E-invoice tab (if any)
  try {
    const id = `${frappe.scrub(frm.doctype, "-")}-custom-einvoice`;
    frm.layout.page.find(`#${id}-tab`).closest("li.nav-item").remove();
    frm.layout.page.find(`#${id}`).remove();
  } catch (e) {
    // no-op
  }
}

function add_einvoice_form_tab(frm) {
  if (!frm || !frm.layout) return;

  // Ensure the form uses tabbed layout
  const $tabs_ul = frm.layout.page.find(".form-tabs");
  const $tabs_content = frm.layout.page.find(".form-tab-content");
  if (!$tabs_ul.length || !$tabs_content.length) return;

  // Unique ids for the tab and its container
  const tab_id = `${frappe.scrub(frm.doctype, "-")}-custom-einvoice`;
  const container_id = `${tab_id}-container`;

  // Clean any existing instance (handles multiple refreshes)
  remove_einvoice_tab(frm);

  if (!frm.doc.custom_zatca_status) return;
  // Fetch latest E-invoice data (if any) and then build the tab
  frappe.call({
    method: "frappe.client.get_list",
    args: {
      doctype: "Sales Invoice Additional Fields",
      filters: {
        sales_invoice: frm.doc.name,
        invoice_doctype: "Sales Invoice",
        is_latest: 1,
      },
      fields: ["name"],
      limit: 1,
    },
    callback: function (r) {
      const einvoice = r.message && r.message.length ? r.message[0] : null;

      // Add the tab link at the end of the tab list
      const $li = $(`
        <li class="nav-item" data-einvoice-tab="1">
          <a class="nav-link" id="${tab_id}-tab" data-toggle="tab" href="#${tab_id}" role="tab" aria-controls="${tab_id}">
            ${__("E-invoice")}
          </a>
        </li>
      `);
      $tabs_ul.append($li);

      // Add the tab pane
      const $pane = $(`
        <div class="tab-pane fade" id="${tab_id}" role="tabpanel" aria-labelledby="${tab_id}-tab">
          <div class="p-3">
            <div id="${container_id}" style="min-height: 500px;">
              <div class="loading-indicator" style="text-align: center; padding: 50px; color: #888;">
                ${einvoice
          ? `<i class="fa fa-spinner fa-spin" style="font-size: 24px;"></i><br><br>${__("Loading E-invoice details...")}`
          : __("No E-invoice data found for this invoice.")
        }
              </div>
            </div>
          </div>
        </div>
      `);
      $tabs_content.append($pane);

      // Open in new tab action
      $pane.find(".open-einvoice-form").on("click", function () {
        if (einvoice)
          frappe.set_route(
            "Form",
            "Sales Invoice Additional Fields",
            einvoice.name
          );
      });

      // Lazy-load embedded document when the tab becomes active
      $li.find("a.nav-link").on("shown.bs.tab", function () {
        if (!einvoice) return; // nothing to load
        if (!$pane.data("loaded")) {
          load_einvoice_in_form_tab_by_id(frm, container_id, einvoice.name);
          $pane.data("loaded", true);
        }
      });
    },
  });
}

function load_einvoice_in_form_tab_by_id(parent_frm, container_id, doc_name) {
  const container = document.getElementById(container_id);
  if (!container) return;

  frappe.model.with_doc(
    "Sales Invoice Additional Fields",
    doc_name,
    function () {
      const doc = frappe.get_doc("Sales Invoice Additional Fields", doc_name);

      const form_wrapper = $(
        `<div class="embedded-einvoice-form" style="background: white;"></div>`
      ).appendTo(container);
      form_wrapper.hide();

      frappe.model.with_doctype("Sales Invoice Additional Fields", function () {
        const form = new frappe.ui.form.Form(
          "Sales Invoice Additional Fields",
          form_wrapper[0],
          false
        );

        form.doc = doc;
        form.docname = doc_name;
        form.doctype = "Sales Invoice Additional Fields";
        form.refresh();

        setTimeout(() => {
          form.disable_form();
          form_wrapper
            .find(
              ".layout-side-section, .page-head, .form-footer, .form-assignments, .form-comments, .form-shared, .form-attachments, .btn-primary, .btn-secondary, .form-print-wrapper"
            )
            .hide();
          form_wrapper.find(".form-layout").css({
            "max-height": "600px",
            "overflow-y": "auto",
            border: "1px solid #d1d8dd",
            "border-radius": "4px",
            padding: "15px",
          });
          form_wrapper
            .find(".form-layout .form-tabs-list")
            .css({ position: "relative", top: "auto" });
          $(container).find(".loading-indicator").remove();
          form_wrapper.show();

          // Reset the breadcrumbs back to the parent form's module
          frappe.breadcrumbs.add(parent_frm.meta.module, parent_frm.doctype);
        }, 800);
      });
    }
  );
}
