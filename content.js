(() => {
    'use strict';

    const processed  = new WeakSet();
    const dataRCache = new WeakSet();

    const SAFE_TAGS = new Set([
        'BODY', 'HTML', 'MAIN', 'HEADER',
        'FOOTER', 'ARTICLE', 'SECTION', 'NAV',
    ]);

    function isSafe(el) {
        return !el || SAFE_TAGS.has(el.tagName);
    }

    function isTooLarge(el) {
        return (
            el.offsetWidth  > window.innerWidth  * 0.7 &&
            el.offsetHeight > window.innerHeight * 0.7
        );
    }

    function hasDataR(el) {
        if (dataRCache.has(el)) return true;
        const found = [...el.attributes].some(a =>
            a.name.startsWith('data-r-i-') ||
            a.name.startsWith('data-r-a-')
        );
        if (found) dataRCache.add(el);
        return found;
    }

    function subtreeHasDataR(el) {
        if (hasDataR(el)) return true;
        for (const child of el.querySelectorAll('*')) {
            if (hasDataR(child)) return true;
        }
        return false;
    }

    function remove(el, reason) {
        if (!el)                  return;
        if (!el.isConnected)      return;
        if (processed.has(el))    return;
        if (isSafe(el))           return;
        if (isTooLarge(el))       return;
        if (el.offsetWidth  < 10) return;
        if (el.offsetHeight < 10) return;

        processed.add(el);
        console.log('[AdCleaner]', reason, el);
        el.remove();
    }

    function findContainer(startEl, maxSteps = 12) {
        let candidate = null;
        let cur = startEl;

        for (let i = 0; i < maxSteps && cur && !isSafe(cur); i++) {
            if (isTooLarge(cur)) break;

            const hasMarker = cur.querySelector('[data-id="MARKER"]') !== null;
            const hasR      = subtreeHasDataR(cur);

            if (hasMarker && hasR) {
                candidate = cur;
                break;
            }

            if (
                (hasMarker || hasR) &&
                cur.offsetWidth  > 80 &&
                cur.offsetHeight > 40 &&
                !candidate
            ) {
                candidate = cur;
            }

            cur = cur.parentElement;
        }

        return candidate;
    }

    function findShadowContainer(dataREl, maxSteps = 8) {
        let best = null;
        let cur  = dataREl.parentElement;

        for (let i = 0; i < maxSteps && cur && !isSafe(cur); i++) {
            if (isTooLarge(cur)) break;

            if (cur.textContent.includes('Отключить рекламу')) {
                return { el: cur, deferred: false };
            }

            const display = getComputedStyle(cur).display;
            const isBlock = (
                display === 'block'        ||
                display === 'flex'         ||
                display === 'grid'         ||
                display === 'inline-block' ||
                display === 'inline-flex'
            );

            if (isBlock) {
                best = cur;
                if (cur.offsetWidth > 50) break;
            }

            cur = cur.parentElement;
        }

        if (!best) return null;
        return { el: best, deferred: best.offsetHeight < 10 };
    }

    function retryRemove(containerEl, attempts = 0) {
        if (processed.has(containerEl)) return;
        if (!containerEl.isConnected)   return;

        if (attempts > 8) {
            if (!isTooLarge(containerEl) && !isSafe(containerEl)) {
                processed.add(containerEl);
                console.log('[AdCleaner] shadow-forced', containerEl);
                containerEl.remove();
            }
            return;
        }

        const w = containerEl.offsetWidth;
        const h = containerEl.offsetHeight;

        if (w > 10 && h > 10 && !isTooLarge(containerEl)) {
            remove(containerEl, 'shadow-deferred');
            return;
        }

        setTimeout(
            () => retryRemove(containerEl, attempts + 1),
            100 * Math.pow(1.8, attempts)
        );
    }

    // ── Обработка одного data-r-* или MARKER узла ─────────────────────────────

    function handleAdNode(node) {
        if (processed.has(node)) return;

        const container = findContainer(node);
        if (container) {
            remove(container, 'data-r');
            return;
        }

        const result = findShadowContainer(node);
        if (!result) return;

        if (!result.deferred) {
            remove(result.el, 'shadow-closed');
        } else {
            retryRemove(result.el);
        }
    }

    function handleMarker(marker) {
        if (processed.has(marker)) return;
        const container = findContainer(marker);
        if (container) remove(container, 'MARKER');
    }

    // ── Полный скан поддерева ─────────────────────────────────────────────────

    function processNode(el) {
        el.querySelectorAll('[data-id="MARKER"]').forEach(handleMarker);
        if (el.dataset?.id === 'MARKER') handleMarker(el);

        el.querySelectorAll('*').forEach(node => {
            if (hasDataR(node)) handleAdNode(node);
        });
        if (hasDataR(el)) handleAdNode(el);
    }

    // ── MutationObserver — два режима ─────────────────────────────────────────

    let debounceTimer  = null;
    const pendingNodes = new Set();

    function scheduleProcess(node) {
        pendingNodes.add(node);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const snapshot = [...pendingNodes];
            pendingNodes.clear();
            for (const n of snapshot) {
                if (n.isConnected) processNode(n);
            }
        }, 200);
    }

    new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;

                // Быстрый путь: сам узел — рекламный маркер → без дебаунса
                if (hasDataR(node)) {
                    handleAdNode(node);
                    continue;
                }
                if (node.dataset?.id === 'MARKER') {
                    handleMarker(node);
                    continue;
                }

                // Медленный путь: внутри может быть реклама → дебаунс
                scheduleProcess(node);
            }
        }
    }).observe(document.body, {
        childList: true,
        subtree:   true,
    });

    // ── Первый скан ───────────────────────────────────────────────────────────

    processNode(document.body);

    console.log('[AdCleaner] started on', location.hostname);

})();