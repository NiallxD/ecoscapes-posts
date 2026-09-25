/** Asks before a link takes someone off a map. One tap on home would
 *  otherwise lose where they were, and whatever they had set up there. A
 *  link opened in a new tab or window loses nothing, so that goes straight
 *  through. Styled in Shell.astro (.leave). */
export function confirmLeave(link: HTMLAnchorElement | null, question = 'Are you sure you want to leave the map?') {
  link?.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    ask(question).then((go) => {
      if (go) location.href = link.href;
    });
  });
}

let dialog: HTMLDialogElement | null = null;

function ask(question: string) {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'leave';
    dialog.innerHTML =
      '<p></p><form method="dialog">' +
      '<button value="stay" autofocus>Stay</button>' +
      '<button value="leave" class="leave-go">Leave</button></form>';
    // A click on the dim around it is a no.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog!.close('stay');
    });
    document.body.append(dialog);
  }
  const d = dialog;
  d.querySelector('p')!.textContent = question;
  d.returnValue = '';
  d.showModal();
  return new Promise<boolean>((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'leave'), { once: true }));
}
