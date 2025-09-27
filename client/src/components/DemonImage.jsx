import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EMPTY_ARRAY } from "../utils/constants";

const DEMON_IMAGE_FALLBACK_BASES = [
    "https://static.megatenwiki.com",
    "https://megatenwiki.miraheze.org",
    "https://static.miraheze.org/megatenwiki",
    "https://static.miraheze.org/megatenwikiwiki",
    "https://static.wikia.nocookie.net/megamitensei",
];
const DEMON_IMAGE_FILE_RE = /\.(?:png|jpe?g|gif|webp|svg)$/i;
const DEMON_IMAGE_PROXY_ORIGINS = [
    "megatenwiki.com",
    "www.megatenwiki.com",
    "static.megatenwiki.com",
    "megatenwiki.miraheze.org",
    "static.miraheze.org",
    "static.wikia.nocookie.net",
];

function shouldProxyDemonImage(url) {
    if (typeof url !== "string") return false;
    const trimmed = url.trim();
    if (!trimmed || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) return false;
    if (!/^https?:/i.test(trimmed) && !trimmed.startsWith("//")) return false;
    let parsed;
    try {
        parsed = new URL(trimmed, "https://megatenwiki.com/");
    } catch {
        return false;
    }
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    const host = (parsed.host || "").toLowerCase();
    if (!host) return false;
    return DEMON_IMAGE_PROXY_ORIGINS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function createProxiedImageSource(url) {
    return `/api/personas/image-proxy?src=${encodeURIComponent(url)}`;
}

function finalizeDemonImageSources(sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
        return EMPTY_ARRAY;
    }

    const finalSources = [];
    const pushSource = (value) => {
        if (!value) return;
        const normalized = value.trim();
        if (!normalized) return;
        if (finalSources.includes(normalized)) return;
        finalSources.push(normalized);
    };

    for (const source of sources) {
        if (shouldProxyDemonImage(source)) {
            pushSource(createProxiedImageSource(source));
        }
        pushSource(source);
    }

    return finalSources;
}

function computeDemonImageSources(imageUrl, { personaSlug } = {}) {
    const trimmed = typeof imageUrl === "string" ? imageUrl.trim() : "";
    const slug = typeof personaSlug === "string" ? personaSlug.trim() : "";

    const sources = [];
    const seen = new Set();
    const addSource = (value) => {
        if (!value) return;
        const normalized = value.trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        sources.push(normalized);
    };

    if (slug) {
        addSource(`/api/personas/${encodeURIComponent(slug)}/image`);
    }

    if (!trimmed) {
        return finalizeDemonImageSources(sources);
    }

    addSource(trimmed);

    const isDataUrl = /^data:/i.test(trimmed);
    const isBlobUrl = /^blob:/i.test(trimmed);
    const isFileScheme = /^file:/i.test(trimmed);
    const isSpecialScheme = /^special:filepath\//i.test(trimmed);

    let fileName = "";
    if (isFileScheme) {
        fileName = trimmed.slice(trimmed.indexOf(":") + 1).split(/[?#]/)[0].trim();
    } else if (isSpecialScheme) {
        fileName = trimmed.slice(trimmed.indexOf("/") + 1).split(/[?#]/)[0].trim();
    } else if (/^images\//i.test(trimmed)) {
        fileName = trimmed.split("/").pop()?.split(/[?#]/)[0].trim() || "";
    } else if (!trimmed.includes("://")) {
        fileName = trimmed.split(/[/?#]/).pop()?.trim() || "";
    }

    let parsed = null;
    let parsedHost = "";
    const shouldAddSpecialFallback = () => {
        if (!fileName) return false;
        if (isFileScheme || isSpecialScheme || /^images\//i.test(trimmed) || !trimmed.includes("://")) {
            if (!DEMON_IMAGE_FILE_RE.test(fileName) && !(isFileScheme || isSpecialScheme)) {
                return false;
            }
            return true;
        }
        if (!DEMON_IMAGE_FILE_RE.test(fileName)) return false;
        if (!parsedHost) return false;
        return /megaten|persona|nocookie|atlus/i.test(parsedHost);
    };
    const addSpecialFallback = () => {
        if (!shouldAddSpecialFallback()) return;
        addSource(`https://megatenwiki.com/wiki/Special:FilePath/${fileName}`);
    };

    if (isFileScheme && fileName) {
        addSpecialFallback();
        try {
            parsed = new URL(`https://megatenwiki.com/wiki/Special:FilePath/${fileName}`);
        } catch {
            parsed = null;
        }
    } else {
        try {
            parsed = new URL(trimmed);
            addSource(parsed.toString());
        } catch {
            if (!isDataUrl && !isBlobUrl) {
                if (isSpecialScheme && fileName) {
                    const specialUrl = `https://megatenwiki.com/wiki/${trimmed}`;
                    addSource(specialUrl);
                    try {
                        parsed = new URL(specialUrl);
                    } catch {
                        parsed = null;
                    }
                }
                if (!parsed) {
                    try {
                        parsed = new URL(trimmed, "https://megatenwiki.com/");
                        addSource(parsed.toString());
                    } catch {
                        parsed = null;
                    }
                }
            }
        }
    }

    if (!parsed) {
        addSpecialFallback();
        return finalizeDemonImageSources(sources);
    }

    const { protocol, host, pathname, search, hash } = parsed;
    parsedHost = (host || "").toLowerCase();

    if (protocol === "http:") {
        addSource(`https://${host}${pathname}${search}${hash}`);
    }

    if (!fileName) {
        const segment = pathname.split("/").filter(Boolean).pop();
        if (segment) {
            fileName = segment.split(/[?#]/)[0];
        }
    }

    let imagePath = "";
    const pathMatch = pathname.match(/(\/images\/[^?#]+)/i);
    if (pathMatch) {
        imagePath = pathMatch[1];
    } else if (/^images\//i.test(trimmed)) {
        imagePath = `/${trimmed.replace(/^\/+/, "")}`;
    } else {
        const trimmedMatch = trimmed.match(/(\/images\/[^?#]+)/i);
        if (trimmedMatch) {
            imagePath = trimmedMatch[1];
        }
    }

    if (imagePath) {
        for (const base of DEMON_IMAGE_FALLBACK_BASES) {
            addSource(`${base}${imagePath}`);
        }
    }

    if (fileName) {
        addSpecialFallback();
    }

    return finalizeDemonImageSources(sources);
}

export default function DemonImage({
    src,
    alt,
    personaSlug,
    onError,
    crossOrigin: crossOriginProp,
    referrerPolicy: referrerPolicyProp,
    enablePreview = false,
    ...imgProps
}) {
    const sources = useMemo(() => computeDemonImageSources(src, { personaSlug }), [src, personaSlug]);
    const [index, setIndex] = useState(0);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const closeButtonRef = useRef(null);

    useEffect(() => {
        setIndex(0);
    }, [sources]);

    useEffect(() => {
        if (!enablePreview) {
            setIsPreviewOpen(false);
        }
    }, [enablePreview]);

    const handleError = useCallback(
        (event) => {
            if (index < sources.length - 1) {
                setIndex((prev) => prev + 1);
            } else if (onError) {
                onError(event);
            }
        },
        [index, onError, sources.length],
    );

    const openPreview = useCallback(() => {
        if (!enablePreview || sources.length === 0) return;
        setIsPreviewOpen(true);
    }, [enablePreview, sources.length]);

    const closePreview = useCallback(() => {
        setIsPreviewOpen(false);
    }, []);

    useEffect(() => {
        if (!enablePreview || !isPreviewOpen) return undefined;
        const handleKey = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setIsPreviewOpen(false);
            }
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [enablePreview, isPreviewOpen]);

    useEffect(() => {
        if (!enablePreview || !isPreviewOpen) return undefined;
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previous;
        };
    }, [enablePreview, isPreviewOpen]);

    useEffect(() => {
        if (!enablePreview || !isPreviewOpen) return;
        closeButtonRef.current?.focus();
    }, [enablePreview, isPreviewOpen]);

    if (sources.length === 0) {
        return null;
    }

    const crossOrigin = crossOriginProp ?? "anonymous";
    const referrerPolicy = referrerPolicyProp ?? "no-referrer";

    const {
        className: imgClassName,
        onClick: imgOnClick,
        onKeyDown: imgOnKeyDown,
        tabIndex: imgTabIndex,
        role: imgRole,
        ["aria-haspopup"]: imgAriaHasPopup,
        ...restImgProps
    } = imgProps;

    const interactive = enablePreview && sources.length > 0;

    const handleImageClick = (event) => {
        if (imgOnClick) {
            imgOnClick(event);
        }
        if (event.defaultPrevented) return;
        openPreview();
    };

    const handleImageKeyDown = (event) => {
        if (imgOnKeyDown) {
            imgOnKeyDown(event);
        }
        if (event.defaultPrevented) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPreview();
        }
    };

    const mergedClassName = interactive
        ? [imgClassName, "demon-image--interactive"].filter(Boolean).join(" ")
        : imgClassName;

    const finalTabIndex = interactive ? imgTabIndex ?? 0 : imgTabIndex;
    const finalRole = interactive ? imgRole ?? "button" : imgRole;
    const finalAriaHasPopup = interactive ? imgAriaHasPopup ?? "dialog" : imgAriaHasPopup;

    return (
        <>
            <img
                {...restImgProps}
                className={mergedClassName}
                alt={alt}
                src={sources[index]}
                onError={handleError}
                onClick={interactive ? handleImageClick : imgOnClick}
                onKeyDown={interactive ? handleImageKeyDown : imgOnKeyDown}
                tabIndex={finalTabIndex}
                role={finalRole}
                aria-haspopup={finalAriaHasPopup}
                crossOrigin={crossOrigin}
                referrerPolicy={referrerPolicy}
            />
            {interactive && isPreviewOpen && (
                <div
                    className="demon-image-lightbox"
                    role="dialog"
                    aria-modal="true"
                    aria-label={alt || "Demon artwork preview"}
                    onClick={closePreview}
                >
                    <div className="demon-image-lightbox__body" onClick={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            className="btn ghost btn-small demon-image-lightbox__close"
                            onClick={closePreview}
                            ref={closeButtonRef}
                        >
                            Close
                        </button>
                        <img
                            src={sources[index]}
                            alt={alt}
                            className="demon-image-lightbox__image"
                            crossOrigin={crossOrigin}
                            referrerPolicy={referrerPolicy}
                        />
                    </div>
                </div>
            )}
        </>
    );
}
