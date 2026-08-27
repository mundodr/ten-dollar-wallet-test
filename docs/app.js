document.querySelectorAll("[data-copy]").forEach(button => button.addEventListener("click", async () => {
  const original = button.textContent;
  await navigator.clipboard.writeText(document.querySelector(`#${button.dataset.copy}`).textContent);
  button.textContent = "已复制 · COPIED";
  setTimeout(() => { button.textContent = original; }, 1600);
}));
