frappe.ui.form.on("POS Closing Entry", {
  onload: function (frm) {
    if (Boolean(__TAURI__)) {
      setThunderPosHeader();
    }
  },
});

function setThunderPosHeader() {
  //   document.querySelector(".sidebar-toggle-btn").classList.add("hide");
  if (window.thunder_pos_header_set) return;

  document
    .querySelectorAll(
      "header.navbar:not(.thunder-pos-header), .breadcrumb, .navbar-brand,.sidebar-toggle-btn"
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

  container.innerHTML = `
        <div class="left-section">
            <div class="flex">
                <h3 class="ellipsis title-text mb-0 mr-2" title="Point of Sale">Thunder POS</h3>
                <span class="indicator-pill no-indicator-dot whitespace-nowrap blue">
                    <span>${window?.pos_profile_name || ""}</span>
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

  //   actionMenu.querySelectorAll('ul.dropdown-menu li.user-action').forEach(li => {
  //     ['Full Screen', 'Open Form View'].includes(li.querySelector('.menu-item-label')?.textContent.trim()) && li.classList.add('hide');
  //   });
  //   pageHead.remove();
  stickyHeader.innerHTML = "";
  stickyHeader.appendChild(newHeader);
  //   stickyHeader.querySelector('.right-section').appendChild(actionMenu);
}
