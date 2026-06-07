(() => {
    'use strict';

    const processed  = new WeakSet();
    const dataRCache = new WeakSet(); // кэш элементов с data-r-*
    const isDebug = location.search.includes('ym-cleaner-debug=1');

    const SAFE_TAGS = new Set([
        'BODY', 'HTML', 'MAIN', 'HEADER',
        'FOOTER', 'ARTICLE', 'SECTION', 'NAV',
    ]);

    // ── Helpers ──────────────────────────────────────────────────────────────

    function isSafe(el) {
        return !el || SAFE_TAGS.has(el.tagName);
    }

    function isTooLarge(el) {
        // Блокируем только если большой по ОБЕИМ осям одновременно
        // (правая колонка может быть высокой, но узкой — это нормально)
        return (
            el.offsetWidth  > window.innerWidth  * 0.7 &&
            el.offsetHeight > window.innerHeight * 0.7
        );
    }

    // Проверка с кэшем, без повторного перебора атрибутов
    function hasDataR(el) {
        if (dataRCache.has(el)) return true;
        const found = [...el.attributes].some(a =>
            a.name.startsWith('data-r-i-') ||
            a.name.startsWith('data-r-a-')
        );
        if (found) dataRCache.add(el);
        return found;
    }

    // querySelector быстрее чем [...querySelectorAll('*')].some()
    function subtreeHasDataR(el) {
        return (
            el.querySelector('[data-r-i-],[data-r-a-]') !== null ||
            // атрибутный селектор без значения — ищем сам элемент тоже
            hasDataR(el)
        );
    }

    // ── Удаление ─────────────────────────────────────────────────────────────

    function remove(el, reason) {
        if (!el)                    return;
        if (!el.isConnected)        return; // защита от detached
        if (processed.has(el))      return;
        if (isSafe(el))             return;
        if (isTooLarge(el))         return;
        if (el.offsetWidth  < 10)   return;
        if (el.offsetHeight < 10)   return;

        processed.add(el);
        if (isDebug) console.log('[AdCleaner]', reason, el);
        el.remove();
    }

    // ── Поиск контейнера ──────────────────────────────────────────────────────

    // Ищем минимальный родитель, который содержит оба якоря: MARKER и data-r-*
    function findContainer(startEl, maxSteps = 12) {

        let candidate = null;
        let cur = startEl;

        for (let i = 0; i < maxSteps && cur && !isSafe(cur); i++) {

            if (isTooLarge(cur)) break;

            const hasMarker = cur.querySelector('[data-id="MARKER"]') !== null;
            const hasR      = subtreeHasDataR(cur);

            // Идеальный контейнер — оба якоря рядом
            if (hasMarker && hasR) {
                candidate = cur;
                break;
            }

            // Запасной: один якорь + минимальный видимый размер
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

    // Для shadow-closed блоков (Кинопоиск):
    // ищем родителя с "Отключить рекламу" или именованный id-контейнер
    function findShadowContainer(dataREl, maxSteps = 8) {

        let cur = dataREl.parentElement;

        for (let i = 0; i < maxSteps && cur && !isSafe(cur); i++) {

            if (isTooLarge(cur)) break;

            if (cur.textContent.includes('Отключить рекламу')) {
                return cur;
            }

            if (
                cur.id &&
                subtreeHasDataR(cur) &&
                cur.offsetWidth  > 80 &&
                cur.offsetHeight > 40
            ) {
                return cur;
            }

            cur = cur.parentElement;
        }

        return null;
    }

    // ── Обработка одного узла ─────────────────────────────────────────────────

    function processNode(el) {

        // MARKER
        el.querySelectorAll('[data-id="MARKER"]').forEach(marker => {
            if (processed.has(marker)) return;
            const container = findContainer(marker);
            if (container) remove(container, 'MARKER');
        });

        // data-r-*
        el.querySelectorAll('*').forEach(node => {
            if (!hasDataR(node))       return;
            if (processed.has(node))   return;

            const container = findContainer(node);
            if (container) {
                remove(container, 'data-r container');
                return;
            }

            const shadowContainer = findShadowContainer(node);
            if (shadowContainer) {
                remove(shadowContainer, 'shadow-closed');
            }
        });
    }

    // ── Дебаунс + MutationObserver ────────────────────────────────────────────

    let debounceTimer = null;
    const pendingNodes = new Set();

    function scheduleProcess(nodes) {
        for (const n of nodes) pendingNodes.add(n);

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const snapshot = [...pendingNodes];
            pendingNodes.clear();
            for (const n of snapshot) {
                if (n.isConnected) processNode(n);
            }
        }, 150); // 150 мс — баланс между скоростью и нагрузкой
    }

    // ── Запуск ────────────────────────────────────────────────────────────────

    // Первый скан — весь document.body
    processNode(document.body);

    // Следующие сканы — только новые узлы
    new MutationObserver(mutations => {
        const added = [];
        for (const m of mutations) {
            for (const n of m.addedNodes) {
                if (n.nodeType === Node.ELEMENT_NODE) added.push(n);
            }
        }
        if (added.length) scheduleProcess(added);
    }).observe(document.body, {
        childList: true,
        subtree:   true,
    });

    if (isDebug) console.log('[AdCleaner] started on', location.hostname);

})();