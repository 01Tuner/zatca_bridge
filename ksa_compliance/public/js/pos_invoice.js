frappe.ui.form.on("POS Invoice", {
  onload: function (frm) {

    if(Boolean(__TAURI__)) {
        setThunderPosHeader();
        setTauriPrintPolyfill();
    }
  },
  refresh: function (frm) {
    if(window.RELOAD_THUNDER_POS_HEADER) {
      window.location.reload();
      window.RELOAD_THUNDER_POS_HEADER = false;
    }

    if(Boolean(__TAURI__)) {
      hideStandardMenu();
    }
  }
});

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
    
    // Add Silent Print button
    if (Boolean(__TAURI__)) {
      frm.add_custom_button(
        __("Silent Print"),
        function () {
          silentPrintPosInvoice(frm);
        }
      );
    }
  },
});

function silentPrintPosInvoice(frm) {
  if (!frm.doc.name) {
    frappe.msgprint(__("Please save the document first"));
    return;
  }
  
  // Generate print URL
  const print_url = frappe.urllib.get_full_url(
    `/printview?doctype=${frm.doctype}&name=${frm.doc.name}&format=POS Invoice&no_letterhead=0&letterhead=${frm.doc.letter_head || ''}&settings={}`
  );
  
  // Use Tauri's silent print
  if (window.__TAURI__ && window.__TAURI__.core) {
    window.__TAURI__.core
      .invoke("silent_print", {
        url: print_url,
        copies: 1
      })
      .then(() => {
        frappe.show_alert(__("Document sent to printer"));
      })
      .catch((err) => {
        console.error("Silent print failed:", err);
        frappe.msgprint(__("Print failed: {0}", [err]));
      });
  } else {
    frappe.msgprint(__("Silent print is only available in desktop app"));
  }
}

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

function setThunderPosHeader() {
  if (window.thunder_pos_header_set) return;

  document
    .querySelectorAll(
      "header.navbar:not(.thunder-pos-header), .page-container .page-head, .breadcrumb, .navbar-brand, .pos-page .page-head .sidebar-toggle-btn"
    )
    .forEach((el) => {
      el.style.display = "none";
    });

  const userMenu = document.querySelector("header .dropdown-navbar-user");
  const actionMenu = document.querySelector(
    ".page-container .page-head .standard-actions"
  );
  const pageHead = document.querySelector(".page-container .page-head");
  const stickyHeader = document.querySelector(".sticky-top");

  // Remove existing
  const existing = document.querySelector("header.thunderpos");
  if (existing) existing.remove();

  // Create new header
  const container = document.createElement("div");
  container.className = "container";
  window.pos_profile_name = cur_pos.pos_profile;
  container.innerHTML = `
        <div class="left-section">
            <div class="flex">
                <button class="btn btn-sm btn-secondary mr-2" onclick="frappe.set_route('point-of-sale')" title="Go to Home">
                    <i class="fa fa-home"></i>
                </button>
                ${window.history.length > 1 && frappe.get_route_str() !== 'point-of-sale' ? '<button class="btn btn-sm btn-secondary mr-2" onclick="window.history.back()" title="Go Back"><i class="fa fa-arrow-left"></i></button>' : ''}
                <h3 class="ellipsis title-text mb-0 mr-2" title="Point of Sale">Thunder POS</h3>
                <span class="indicator-pill no-indicator-dot whitespace-nowrap blue">
                    <span>${cur_pos.pos_profile}</span>
                </span>
            </div>
        </div>
        <div class="right-section row flex align-center flex-row-reverse">
        </div>
    `;

  // Add user menu clone
  const userMenuClone = userMenu.cloneNode(true);
  userMenuClone.className =
    "flex nav-item dropdown dropdown-navbar-user dropdown-mobile";
  container.querySelector(".right-section").appendChild(userMenuClone);

  userMenuClone
    .querySelectorAll("button.dropdown-item, a.dropdown-item")
    .forEach((btn) => {
      !["Log out", "Reload", "Toggle Theme"].includes(
        btn?.textContent.trim()
      ) && btn.classList.add("hide");
    });
  const newHeader = document.createElement("header");
  newHeader.className = "navbar thunderpos";
  newHeader.appendChild(container);

  actionMenu
    .querySelectorAll("ul.dropdown-menu li.user-action")
    .forEach((li) => {
      ["Full Screen", "Open Form View"].includes(
        li.querySelector(".menu-item-label")?.textContent.trim()
      ) && li.classList.add("hide");
    });
  //   pageHead.remove();
  stickyHeader.innerHTML = "";
  stickyHeader.appendChild(newHeader);
  stickyHeader.querySelector(".right-section").appendChild(actionMenu);

  window.thunder_pos_header_set = true;
}

function hideStandardMenu () {
    document.querySelectorAll('header .standard-actions ul.dropdown-menu li.user-action')
    ?.forEach((li) => {
      ["Full Screen", "Open Form View"].includes(
        li.querySelector(".menu-item-label")?.textContent.trim()
      ) && li.classList.add("hide");
    });
}

function setTauriPrintPolyfill() {
  if (window.tauri_print_polyfill_set) return;

  // Polyfill for Tauri print function
  window.print = () => {
    window.__TAURI__.invoke("print");
  };

  window.open = function (url, name, features) {
    console.log("🖨️ Thunder POS: Opening window:", url);

    // Create mock window for popup blocker detection
    const mockWindow = {
      closed: false,
      location: { href: url || "about:blank" },
      name: name || "",
      opener: window,
      parent: window,
      close: function () {
        this.closed = true;
      },
      focus: function () {
        return true;
      },
      print: function () {
        return true;
      },
    };
    mockWindow.self = mockWindow;
    mockWindow.window = mockWindow;

    // Create actual window through Tauri if URL provided
    if (url && window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core
        .invoke("open_print_window", {
          url: url,
          window_features: features || "width=800,height=600",
        })
        .then((windowId) => {
          console.log("✅ Print window created:", windowId);
        })
        .catch((err) => {
          console.error("❌ Print window failed:", err);
          // Fallback to original window.open
          originalWindowOpen(url, name, features);
        });
    }

    return mockWindow;
  };

  applyPopupBlockerOverrides();

  window.tauri_print_polyfill_set = true;
}

// Enhanced window.open polyfill for Tauri
const originalWindowOpen = window.open.bind(window);

window.open = function (url, name, features) {
  console.log("🖨️ Thunder POS: Opening window:", url);

  // Create mock window for popup blocker detection
  const mockWindow = {
    closed: false,
    location: { href: url || "about:blank" },
    name: name || "",
    opener: window,
    parent: window,
    close: function () {
      this.closed = true;
    },
    focus: function () {
      return true;
    },
    print: function () {
      return true;
    },
  };
  mockWindow.self = mockWindow;
  mockWindow.window = mockWindow;

  // Create actual window through Tauri if URL provided
  if (url && window.__TAURI__ && window.__TAURI__.core) {
    window.__TAURI__.core
      .invoke("open_print_window", {
        url: url,
        window_features: features || "width=800,height=600",
      })
      .then((windowId) => {
        console.log("✅ Print window created:", windowId);
      })
      .catch((err) => {
        console.error("❌ Print window failed:", err);
        // Fallback to original window.open
        originalWindowOpen(url, name, features);
      });
  }

  return mockWindow;
};

// Simple popup blocker prevention
function applyPopupBlockerOverrides() {
  // Set essential popup blocker properties
  Object.defineProperty(window, "popup_blocker_detected", {
    value: false,
    writable: false,
  });

  window.isPopupBlocked = () => false;

  // ERPNext specific overrides
  if (window.frappe && window.frappe.utils) {
    window.frappe.utils.is_popup_blocked = () => false;
  }
}
