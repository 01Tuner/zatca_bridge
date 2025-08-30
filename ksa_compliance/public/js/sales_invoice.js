frappe.ui.form.on("Sales Invoice", {
  setup: function (frm) {
    frm.set_query(
      "custom_return_against_additional_references",
      function (doc) {
        // Similar to logic in erpnext/public/js/controllers/transaction.js for return_against
        let filters = {
          docstatus: 1,
          is_return: 0,
          company: doc.company,
        };
        if (frm.fields_dict["customer"] && doc.customer)
          filters["customer"] = doc.customer;
        if (frm.fields_dict["supplier"] && doc.supplier)
          filters["supplier"] = doc.supplier;

        return {
          filters: filters,
        };
      }
    );
  },

  refresh: function (frm) {
    // Log the current document to the console for debugging
    console.log("ZATCA Status:", frm.doc.custom_zatca_status);

    // Always try to add the E-invoice tab (will show a message if no data)
    add_einvoice_form_tab(frm);

    // Update page title indicator with ZATCA status alongside document status
    setTimeout(() => update_zatca_indicator(frm), 0);
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

  if(!frm.doc.custom_zatca_status) return;
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
                <i class="fa fa-spinner fa-spin" style="font-size: 24px;"></i><br><br>
                ${
                  einvoice
                    ? __("Loading E-invoice details...")
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
          load_einvoice_in_form_tab_by_id(container_id, einvoice.name);
          $pane.data("loaded", true);
        }
      });
    },
  });
}

function load_einvoice_in_form_tab_by_id(container_id, doc_name) {
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
              ".form-toolbar, .layout-side-section, .page-head, .form-footer, .form-assignments, .form-comments, .form-shared, .form-attachments, .btn-primary, .btn-secondary, .form-print-wrapper"
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
        }, 800);
      });
    }
  );
}
