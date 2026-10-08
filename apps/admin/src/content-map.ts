/**
 * «Карта контента» — markdown с админ-маршрута. Токен только в заголовке X-Admin-Token.
 * Вкладка открывается сразу по клику (иначе браузер режет window.open после await),
 * затем в неё пишется текст. noopener в третьем аргументе window.open в Chrome
 * возвращает null, поэтому opener обнуляется вручную.
 */

export function fillMarkdownDocument(doc: Document, markdown: string, title: string) {
  doc.title = title;
  doc.body.replaceChildren();
  const pre = doc.createElement("pre");
  pre.textContent = markdown;
  pre.style.whiteSpace = "pre-wrap";
  pre.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
  doc.body.append(pre);
}

export async function openContentMap(opts: {
  version: string;
  open: () => Window | null;
  load: (version: string) => Promise<string>;
  onError: (message: string) => void;
}): Promise<void> {
  const w = opts.open();
  if (!w) {
    opts.onError("Браузер заблокировал окно с картой контента");
    return;
  }
  w.opener = null;
  try {
    const md = await opts.load(opts.version);
    fillMarkdownDocument(w.document, md, `Карта контента ${opts.version}`);
  } catch (e) {
    w.close();
    opts.onError(e instanceof Error ? e.message : "Не удалось загрузить карту контента");
  }
}
