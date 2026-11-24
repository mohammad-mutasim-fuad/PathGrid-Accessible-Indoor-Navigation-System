import { useEffect, useState } from 'react';

/**
 * Loads a floor-plan blueprint image for canvas drawing.
 * Returns the loaded HTMLImageElement, or null while loading / on error /
 * when no URL is given.
 */
export default function useFloorPlanImage(url) {
  const [image, setImage] = useState(null);

  useEffect(() => {
    setImage(null);
    if (!url) return undefined;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (!cancelled) setImage(img); };
    img.onerror = () => { if (!cancelled) setImage(null); };
    img.src = url;
    return () => { cancelled = true; };
  }, [url]);

  return image;
}
