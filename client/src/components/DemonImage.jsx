import React, { useCallback, useEffect, useMemo, useState } from "react";

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
    ...imgProps
}) {
    const sources = useMemo(() => computeDemonImageSources(src, { personaSlug }), [src, personaSlug]);
    const [index, setIndex] = useState(0);

    useEffect(() => {
        setIndex(0);
    }, [sources]);

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

    if (sources.length === 0) {
        return null;
    }

    const crossOrigin = crossOriginProp ?? "anonymous";
    const referrerPolicy = referrerPolicyProp ?? "no-referrer";

    return (
        <img
            {...imgProps}
            alt={alt}
            src={sources[index]}
            onError={handleError}
            crossOrigin={crossOrigin}
            referrerPolicy={referrerPolicy}
        />
    );
}
