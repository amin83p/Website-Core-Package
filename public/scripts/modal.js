// // ======================================================
// //  PRIORITY MESSAGE MODAL (FREEZES OTHER MODALS)
// // ======================================================
// function showMessageModal(
//   { title = "", icon = null, message = "", size = "md", buttons = [], redirecting = null } = {}
// ) {
//   return new Promise((resolve) => {

//     const modalEl = document.getElementById("messageModal");
//     if (!modalEl) {
//       console.error("❌ messageModal not found");
//       resolve("Error: Modal element missing");
//       return;
//     }

//     // Elements
//     const titleEl = document.getElementById("messageModalTitle");
//     const iconEl = document.getElementById("messageModalIcon");
//     const bodyEl = document.getElementById("messageModalBody");
//     const footerEl = document.getElementById("messageModalButtons");
//     const dialog = modalEl.querySelector(".modal-dialog");
//     const headerEl = modalEl.querySelector(".modal-header");

//     if (!titleEl || !iconEl || !bodyEl || !footerEl || !dialog) {
//       console.error("❌ Missing modal sub-elements");
//       resolve("Error: Incomplete modal structure");
//       return;
//     }

//     // Reset state
//     titleEl.textContent = "";
//     bodyEl.innerHTML = "";
//     footerEl.innerHTML = "";
//     iconEl.className = "bi";
//     headerEl.className = "modal-header d-flex align-items-center";

//     // Modal size
//     dialog.className = "modal-dialog modal-dialog-centered";
//     if (["sm", "lg"].includes(size)) dialog.classList.add(`modal-${size}`);

//     // Set title and text
//     titleEl.textContent = title;
//     bodyEl.innerHTML = message;

//     // Icon styling
//     if (icon) {
//       const iconMap = {
//         info: "bi-info-circle text-info",
//         success: "bi-check-circle text-success",
//         warning: "bi-exclamation-triangle text-warning",
//         error: "bi-x-circle text-danger",
//       };
//       const cls = iconMap[icon];
//       if (cls) {
//         iconEl.className = "bi " + cls;
//         headerEl.classList.add(cls.split(" ")[1]);
//       }
//       //
//     }

//     // Create buttons (unless redirect)
//     if (!redirecting) {
//       buttons.forEach((btn) => {
//         const b = document.createElement("button");
//         b.type = "button";
//         b.textContent = btn.text;
//         b.className = "btn " + (btn.class || "btn-primary") + " btn-filled";
//         b.addEventListener("click", () => {
//               const resultValue = btn.text; // Store the result value
              
//               // This is the critical change: Hide the modal, but DON'T resolve yet.
//               bsModal.hide(); 
              
//               // Use a variable to ensure the correct result is passed.
//               // We will resolve from the hidden.bs.modal handler.
//               modalEl.dataset.resolveValue = resultValue; 
//         });
//         footerEl.appendChild(b);
//       });      
//       // buttons.forEach((btn) => {
//       //   const b = document.createElement("button");
//       //   b.type = "button";
//       //   b.textContent = btn.text;
//       //   b.className = "btn " + (btn.class || "btn-primary") + " btn-filled";
//       //   console.log(b);
//       //   b.addEventListener("click", () => {
//       //     // Close and resolve only AFTER animation ends
//       //     cleanup();
//       //     resolve(btn.text);
//       //     bsModal.hide();
//       //   });
//       //   footerEl.appendChild(b);
//       // });
//     }

//     // Create Bootstrap modal
//     let bsModal;
//     try {
//       bsModal = new bootstrap.Modal(modalEl, { backdrop: "static", keyboard: false });
//     } catch (e) {
//       console.error("❌ Failed to initialize modal", e);
//       resolve("Error: Modal could not open");
//       return;
//     }

//     // Freeze UI when showing
//     const freezeUI = () => {
//       document.querySelectorAll(".modal.show").forEach(m => {
//         if (m.id !== "messageModal") {
//           m.classList.add("freeze-ui");
//         }
//       });
//       document.body.style.pointerEvents = "none";
//       modalEl.style.pointerEvents = "auto";
//     };

//     // Restore UI when closing
//     const cleanup = () => {
//       document.querySelectorAll(".freeze-ui").forEach(m => m.classList.remove("freeze-ui"));
//       document.body.style.pointerEvents = "";
//     };

//     // On modal close restore UI
//     modalEl.addEventListener(
//         "hidden.bs.modal",
//         () => {
//             cleanup();
//             // Resolve with the value stored in the button click, or 'closed' if resolved by ESC/backdrop.
//             const resolveValue = modalEl.dataset.resolveValue || "closed"; 
//             delete modalEl.dataset.resolveValue; // Clean up
//             resolve(resolveValue);
//         },
//         { once: true }
//     );
//     // modalEl.addEventListener(
//     //   "hidden.bs.modal",
//     //   () => {
//     //     cleanup();
//     //     resolve("closed");
//     //   },
//     //   { once: true }
//     // );

//     // Show modal
//     try {
//       bsModal.show();
//       freezeUI();
//     } catch (e) {
//       cleanup();
//       resolve("Error: show failed");
//       return;
//     }

//     // Handle redirect mode
//     if (typeof redirecting === "string" && redirecting.trim() !== "") {
//       setTimeout(() => {
//         cleanup();
//         bsModal.hide();
//       }, 2000);

//       modalEl.addEventListener(
//         "hidden.bs.modal",
//         () => {
//           window.location.href = redirecting;
//         },
//         { once: true }
//       );
//     }
//   });
// }
    
