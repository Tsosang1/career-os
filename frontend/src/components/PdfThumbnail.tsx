'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';

export default function PdfThumbnail({ signedUrl }: { signedUrl: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!signedUrl) return;
    let cancelled = false;

    async function renderFirstPage() {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

        const loadingTask = pdfjsLib.getDocument({ url: signedUrl! });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        if (cancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        const unscaledViewport = page.getViewport({ scale: 1 });
        const targetWidth = 320;
        const scale = targetWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport,
          canvas,
        }).promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    renderFirstPage();
    return () => {
      cancelled = true;
    };
  }, [signedUrl]);

  if (!signedUrl || failed) {
    return (
      <div className="h-44 w-full bg-[#0B0F17] flex flex-col items-center justify-center text-slate-600 border-b border-slate-800">
        <FileText className="w-8 h-8 mb-1.5" />
        <span className="text-[11px]">PDF Preview</span>
      </div>
    );
  }

  return (
    <div className="h-44 w-full bg-slate-900 overflow-hidden border-b border-slate-800 flex items-start justify-center">
      <canvas ref={canvasRef} className="w-full h-auto object-top" />
    </div>
  );
}
