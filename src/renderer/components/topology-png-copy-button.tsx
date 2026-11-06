import * as React from "react";
import type { TopologyFlow } from "../match/topology-flow";
import { type TopologySvgMeta, toSvg } from "../match/topology-svg";
import { CopyImageError } from "./clipboard-image";
import { Icon } from "./freelens-ui";
import { type CopyStatus, useCopyFeedback } from "./use-copy-feedback";

const ICON: Record<CopyStatus, string> = { idle: "photo_camera", copied: "done", failed: "error_outline" };
const TOOLTIP: Record<CopyStatus, string> = { idle: "Copy as PNG", copied: "Copied", failed: "Copy failed" };

const SCALE = 2;

const LOAD_TIMEOUT_MS = 15_000;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // onload/onerrorのどちらも上がらないとPromiseが永久に未settleになり、ボタンがbusyのまま固まる。
    const timer = setTimeout(
      () => reject(new CopyImageError("svg-load", new Error("image load timed out"))),
      LOAD_TIMEOUT_MS,
    );
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new CopyImageError("svg-load", new Error("image onerror")));
    };
    image.src = url;
  });
}

function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new CopyImageError("png-encode", new Error("toBlob returned null")));
    }, "image/png");
  });
}

async function toPng(svg: string): Promise<Blob> {
  // FreeLensのCSPは img-src が `* data:` で blob: を含まない。blob URLで読ませないこと。
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  // toSvg がwidth/heightを必ず書くため、SVG画像でも固有サイズが取れる。
  canvas.width = image.naturalWidth * SCALE;
  canvas.height = image.naturalHeight * SCALE;
  const context = canvas.getContext("2d");
  if (!context) throw new CopyImageError("canvas-context", new Error("getContext('2d') returned null"));
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return await encodePng(canvas);
}

export function TopologyPngCopyButton({ flow, meta }: { flow?: TopologyFlow; meta?: TopologySvgMeta }) {
  const { status, copyImage } = useCopyFeedback();
  const busyRef = React.useRef(false);

  return (
    <Icon
      material={ICON[status]}
      tooltip={TOOLTIP[status]}
      interactive
      small
      disabled={!flow}
      onClick={() => {
        if (!flow || busyRef.current) return;
        busyRef.current = true;
        void copyImage(toPng(toSvg(flow, meta)), TOOLTIP.idle).finally(() => {
          busyRef.current = false;
        });
      }}
    />
  );
}
