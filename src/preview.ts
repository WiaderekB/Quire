import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export class Preview {
  #loading?: PDFDocumentLoadingTask;
  #document?: PDFDocumentProxy;
  #pages: HTMLElement[] = [];
  #renders = new Map<number, RenderTask>();
  #generation = 0;
  #fit = true;
  #zoom = 1;
  #widths: number[] = [];
  #heights: number[] = [];
  #current = 0;
  #observer: ResizeObserver;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly stack: HTMLElement,
    private readonly status: (page: number, pages: number, zoom: string) => void,
  ) {
    this.#observer = new ResizeObserver(() => this.#layout());
    this.#observer.observe(viewport);
    viewport.addEventListener("scroll", () => this.#visiblePages(), { passive: true });
  }

  get hasDocument() { return !!this.#document; }

  async load(data?: Uint8Array) {
    const generation = ++this.#generation;
    const loading = this.#loading;
    this.#loading = undefined;
    this.#document = undefined;
    this.#renders.forEach(render => render.cancel());
    this.#renders.clear();
    this.#pages = [];
    this.stack.replaceChildren();
    this.status(0, 0, "Fit");
    await loading?.destroy().catch(() => {});
    if (!data || generation !== this.#generation) return;

    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
    if (generation !== this.#generation) return;
    GlobalWorkerOptions.workerSrc = worker;
    const next = getDocument({
      data: data.slice(), useSystemFonts: true,
      cMapUrl: new URL("pdf/cmaps/", location.href).href,
      standardFontDataUrl: new URL("pdf/standard_fonts/", location.href).href,
      wasmUrl: new URL("pdf/wasm/", location.href).href,
      iccUrl: new URL("pdf/iccs/", location.href).href,
    });
    this.#loading = next;
    const document = await next.promise;
    if (generation !== this.#generation) return;
    const sizes = await Promise.all(Array.from({ length: document.numPages }, async (_, index) =>
      (await document.getPage(index + 1)).getViewport({ scale: 1 }),
    ));
    if (generation !== this.#generation) return;
    this.#document = document;
    this.#widths = sizes.map(size => size.width);
    this.#heights = sizes.map(size => size.height);
    this.#current = 1;
    this.#fit = true;
    this.#pages = sizes.map((_, index) => {
      const page = window.document.createElement("div");
      page.className = "pdf-page";
      page.setAttribute("aria-label", `PDF page ${index + 1}`);
      this.stack.append(page);
      return page;
    });
    this.viewport.scrollTop = 0;
    this.#layout();
  }

  zoom(step: number) {
    if (!this.#document) return;
    const scale = this.#fit ? this.#scale(this.#current - 1) : this.#zoom;
    this.#zoom = Math.max(0.25, Math.min(2.5, Math.round((scale + step) * 20) / 20));
    this.#fit = false;
    this.#layout();
  }

  fit() {
    this.#fit = true;
    this.viewport.scrollLeft = 0;
    this.#layout();
  }

  #scale(index: number) {
    if (!this.#fit) return this.#zoom;
    const width = this.viewport.clientWidth;
    const margins = width > 480 ? 88 : 44;
    const height = this.viewport.clientHeight;
    const verticalPadding = width > 480 ? 66 : 44;
    return Math.max(0.15, Math.min(1.15,
      (width - margins) / this.#widths[index], (height - verticalPadding) / this.#heights[index]));
  }

  #layout() {
    if (!this.#document || !this.viewport.clientWidth) return;
    this.#pages.forEach((page, index) => {
      const scale = this.#scale(index);
      const width = Math.floor(this.#widths[index] * scale);
      if (page.style.width === `${width}px`) return;
      page.style.width = `${width}px`;
      page.style.height = `${Math.floor(this.#heights[index] * scale)}px`;
      page.dataset.rendered = "";
      this.#renders.get(index)?.cancel();
      this.#renders.delete(index);
    });
    this.#visiblePages();
  }

  #visiblePages() {
    if (!this.#document || !this.viewport.clientWidth) return;
    const viewport = this.viewport.getBoundingClientRect();
    let area = 0;
    this.#pages.forEach((page, index) => {
      const bounds = page.getBoundingClientRect();
      const visible = Math.min(bounds.bottom, viewport.bottom) - Math.max(bounds.top, viewport.top);
      if (visible > area) {
        area = visible;
        this.#current = index + 1;
      }
      if (bounds.bottom > viewport.top - 240 && bounds.top < viewport.bottom + 240) {
        if (!page.dataset.rendered) void this.#render(index, page);
      } else if (page.dataset.rendered) {
        this.#renders.get(index)?.cancel();
        this.#renders.delete(index);
        page.replaceChildren();
        page.dataset.rendered = "";
      }
    });
    this.status(this.#current, this.#pages.length, this.#fit ? "Fit" : `${Math.round(this.#zoom * 100)}%`);
  }

  async #render(index: number, wrapper: HTMLElement) {
    const document = this.#document;
    const width = wrapper.style.width;
    if (!document) return;
    wrapper.dataset.rendered = width;
    try {
      const page = await document.getPage(index + 1);
      if (document !== this.#document || wrapper.dataset.rendered !== width) return;
      const scale = this.#scale(index);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * ratio });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const render = page.render({ canvas, viewport });
      this.#renders.set(index, render);
      await render.promise;
      if (document === this.#document && this.#renders.get(index) === render) {
        wrapper.replaceChildren(canvas);
        this.#renders.delete(index);
      }
    } catch (error) {
      if (document === this.#document && wrapper.dataset.rendered === width &&
          (error as Error).name !== "RenderingCancelledException") {
        wrapper.textContent = "This page couldn’t be displayed.";
      }
    }
  }
}
