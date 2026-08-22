(() => {
    'use strict';

    const objActive = document.getElementById('idActiveList');
    const objWatched = document.getElementById('idWatchedList');
    const objActiveSection = document.getElementById('idActiveSection');
    const objWatchedSection = document.getElementById('idWatchedSection');
    const objEmpty = document.getElementById('idEmpty');
    const objAddCurrent = document.getElementById('idAddCurrent');
    const objStatus = document.getElementById('idStatus');

    const funcMessage = async function(objMessage) {
        return await new Promise(function(funcResolve) {
            chrome.runtime.sendMessage(objMessage, function(objResponse) {
                if (chrome.runtime.lastError) {
                    funcResolve(null);
                } else {
                    funcResolve(objResponse);
                }
            });
        });
    };

    const funcDate = function(intValue) {
        if ((intValue || 0) === 0) {
            return '';
        }

        return new Intl.DateTimeFormat(undefined, {
            'year': 'numeric',
            'month': 'short',
            'day': 'numeric',
        }).format(new Date(intValue));
    };

    const funcText = function(strValue) {
        return (strValue || '').trim();
    };

    const funcPercent = function(objItem) {
        const objProgress = objItem.objProgress || {};
        let intPercent = objProgress.intPercent || 0;

        if ((objProgress.strState === 'watched') || ((objProgress.boolKnown !== true) && ((objItem.intCompletedAt || 0) !== 0))) {
            intPercent = 100;
        }

        return Math.max(0, Math.min(100, intPercent));
    };

    const funcDuration = function(strValue) {
        const strText = funcText(strValue);

        if (strText === '') {
            return '';
        }

        if (/^\d+$/.test(strText) === false) {
            return strText;
        }

        let intSeconds = parseInt(strText);
        const objParts = [];

        if ((Number.isFinite(intSeconds) === false) || (intSeconds <= 0)) {
            return '';
        }

        while (intSeconds >= 60) {
            objParts.unshift(String(intSeconds % 60).padStart(2, '0'));
            intSeconds = Math.floor(intSeconds / 60);
        }

        objParts.unshift(String(intSeconds));
        return objParts.join(':');
    };

    const funcRelativeDate = function(strValue) {
        const strText = funcText(strValue);
        const intTimestamp = Date.parse(strText);

        if ((strText === '') || (Number.isFinite(intTimestamp) === false) || (/\d{4}-\d{2}-\d{2}|T\d{2}:/i.test(strText) === false)) {
            return strText;
        }

        const intSeconds = Math.max(0, Math.floor((Date.now() - intTimestamp) / 1000));
        const objUnits = [
            { 'intSize': 31536000, 'strName': 'year' },
            { 'intSize': 2592000, 'strName': 'month' },
            { 'intSize': 604800, 'strName': 'week' },
            { 'intSize': 86400, 'strName': 'day' },
            { 'intSize': 3600, 'strName': 'hour' },
            { 'intSize': 60, 'strName': 'minute' },
        ];

        for (let objUnit of objUnits) {
            if (intSeconds >= objUnit.intSize) {
                const intValue = Math.floor(intSeconds / objUnit.intSize);
                return intValue + ' ' + objUnit.strName + (intValue === 1 ? '' : 's') + ' ago';
            }
        }

        return 'just now';
    };

    const funcElement = function(strTag, strClass, strText) {
        const objElement = document.createElement(strTag);

        if (strClass !== '') {
            objElement.className = strClass;
        }

        if (strText !== undefined) {
            objElement.textContent = strText;
        }

        return objElement;
    };

    const funcWatchUrl = function(objItem) {
        const strUrl = funcText(objItem.strUrl);

        if (strUrl !== '') {
            return strUrl;
        }

        if (objItem.strKind === 'short') {
            return 'https://www.youtube.com/shorts/' + objItem.strIdent;
        }

        return 'https://www.youtube.com/watch?v=' + objItem.strIdent;
    };

    const funcTrashIcon = function() {
        const strSvg = 'http://www.w3.org/2000/svg';
        const objSvg = document.createElementNS(strSvg, 'svg');
        const arrPaths = [
            'M4 7h16',
            'M9 7V4h6v3',
            'M7 7v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7',
            'M10 11v6',
            'M14 11v6',
        ];

        objSvg.setAttribute('viewBox', '0 0 24 24');
        objSvg.setAttribute('aria-hidden', 'true');
        objSvg.setAttribute('focusable', 'false');

        for (let strPath of arrPaths) {
            const objPath = document.createElementNS(strSvg, 'path');
            objPath.setAttribute('d', strPath);
            objSvg.appendChild(objPath);
        }

        const objIcon = funcElement('span', 'menu-icon remove-icon');
        objIcon.appendChild(objSvg);

        return objIcon;
    };

    const funcCloseMenus = function(objExcept) {
        for (let objMenu of document.querySelectorAll('.video-row.is-menu-open')) {
            if (objMenu !== objExcept) {
                objMenu.classList.remove('is-menu-open');
                const objButton = objMenu.querySelector('.menu-trigger');

                if (objButton !== null) {
                    objButton.setAttribute('aria-expanded', 'false');
                }
            }
        }
    };

    const funcRow = function(objItem) {
        const objRow = funcElement('a', 'video-row');
        objRow.href = funcWatchUrl(objItem);
        objRow.tabIndex = 0;
        objRow.classList.toggle('is-current', objItem.boolCurrent === true);

        if (objItem.boolCurrent === true) {
            objRow.setAttribute('aria-current', 'true');
        }

        const intPercent = funcPercent(objItem);
        const objThumbwrap = funcElement('div', 'thumb-wrap');
        const objThumb = funcElement('img', 'thumb');
        objThumb.alt = '';
        objThumb.loading = 'lazy';
        objThumb.src = objItem.strThumbnail || ('https://i.ytimg.com/vi/' + objItem.strIdent + '/hqdefault.jpg');
        objThumbwrap.appendChild(objThumb);
        objThumbwrap.appendChild(funcElement('div', 'thumb-play'));

        const strDuration = funcDuration(objItem.strDuration);

        if (strDuration !== '') {
            objThumbwrap.appendChild(funcElement('span', 'duration', strDuration));
        }

        const objThumbprogress = funcElement('div', 'thumb-progress');
        const objThumbfill = funcElement('div', 'thumb-progress-fill');
        objThumbfill.style.width = intPercent + '%';
        objThumbprogress.appendChild(objThumbfill);
        objThumbwrap.appendChild(objThumbprogress);

        const objMeta = funcElement('div', 'meta');
        const strTitle = funcText(objItem.strTitle) || funcText((objItem.objProgress || {}).strTitle) || 'YouTube video';
        const strChannel = funcText(objItem.strChannel);

        objMeta.appendChild(funcElement('div', 'title', strTitle));

        if (strChannel !== '') {
            const objChannelrow = funcElement('div', 'channel-row');
            objChannelrow.appendChild(funcElement('div', 'channel', strChannel));

            if (objItem.boolVerified === true) {
                objChannelrow.appendChild(funcElement('span', 'verified', '\u2713'));
            }

            objMeta.appendChild(objChannelrow);
        }

        const objDetail = [funcText(objItem.strViews), funcRelativeDate(objItem.strPublished)].filter(function(strText) {
            return strText !== '';
        }).join(' \u2022 ');

        if (objDetail !== '') {
            objMeta.appendChild(funcElement('div', 'detail', objDetail));
        }

        const strAdded = funcDate(objItem.intAdded);

        if (strAdded !== '') {
            objMeta.appendChild(funcElement('div', 'added', 'Added to watchlist ' + strAdded));
        }

        const objActions = funcElement('div', 'actions');
        const objMenuButton = funcElement('button', 'menu-trigger', '\u22ee');
        objMenuButton.type = 'button';
        objMenuButton.title = 'More actions';
        objMenuButton.setAttribute('aria-label', 'More actions');
        objMenuButton.setAttribute('aria-haspopup', 'menu');
        objMenuButton.setAttribute('aria-expanded', 'false');
        objMenuButton.addEventListener('click', function(objEvent) {
            objEvent.preventDefault();
            objEvent.stopPropagation();
            const boolOpen = objRow.classList.contains('is-menu-open');
            funcCloseMenus(objRow);
            objRow.classList.toggle('is-menu-open', boolOpen === false);
            objMenuButton.setAttribute('aria-expanded', boolOpen === false ? 'true' : 'false');
        });

        const objMenu = funcElement('div', 'action-menu');
        objMenu.setAttribute('role', 'menu');
        objMenu.addEventListener('click', function(objEvent) {
            objEvent.stopPropagation();
        });

        const objRemove = funcElement('button', 'menu-item remove');
        objRemove.type = 'button';
        objRemove.setAttribute('role', 'menuitem');
        objRemove.appendChild(funcTrashIcon());
        objRemove.appendChild(funcElement('span', 'menu-label', 'Remove'));
        objRemove.addEventListener('click', async function(objEvent) {
            objEvent.preventDefault();
            objEvent.stopPropagation();
            funcCloseMenus();
            await funcMessage({ 'strMessage': 'watchlist:remove', 'strIdent': objItem.strIdent });
            await funcRender();
        });

        objMenu.appendChild(objRemove);
        objActions.appendChild(objMenuButton);
        objActions.appendChild(objMenu);

        objRow.appendChild(objThumbwrap);
        objRow.appendChild(objMeta);
        objRow.appendChild(objActions);

        objRow.addEventListener('click', function(objEvent) {
            if ((objEvent.button !== 0) || (objEvent.metaKey === true) || (objEvent.ctrlKey === true) || (objEvent.shiftKey === true) || (objEvent.altKey === true)) {
                return;
            }

            objEvent.preventDefault();
            funcCloseMenus();
            funcMessage({
                'strMessage': 'watchlist:open',
                'strIdent': objItem.strIdent,
                'strKind': objItem.strKind,
                'strUrl': objItem.strUrl,
            });
        });

        objRow.addEventListener('keydown', function(objEvent) {
            if (objEvent.target !== objRow) {
                return;
            }

            if ((objEvent.key === 'Enter') || (objEvent.key === ' ')) {
                objEvent.preventDefault();
                funcCloseMenus();
                funcMessage({
                    'strMessage': 'watchlist:open',
                    'strIdent': objItem.strIdent,
                    'strKind': objItem.strKind,
                    'strUrl': objItem.strUrl,
                });
            }
        });

        return objRow;
    };

    const funcRenderList = function(objContainer, objItems) {
        const objExisting = new Map();

        for (let objChild of Array.from(objContainer.children)) {
            objExisting.set(objChild.dataset.strIdent, objChild);
        }

        let objPrevious = null;

        for (let objItem of objItems) {
            const strKey = JSON.stringify(objItem);
            const objOld = objExisting.get(objItem.strIdent);
            let objRow = objOld;

            if ((objOld === undefined) || (objOld.dataset.strKey !== strKey)) { // new item, or an existing one whose data actually changed
                objRow = funcRow(objItem);
                objRow.dataset.strIdent = objItem.strIdent;
                objRow.dataset.strKey = strKey;

                if (objOld !== undefined) {
                    objOld.remove(); // drop the stale row so it doesn't linger as an orphaned duplicate
                }
            }

            objExisting.delete(objItem.strIdent);

            if (objPrevious === null) {
                if (objContainer.firstChild !== objRow) {
                    objContainer.insertBefore(objRow, objContainer.firstChild);
                }
            } else if (objPrevious.nextSibling !== objRow) {
                objContainer.insertBefore(objRow, objPrevious.nextSibling);
            }

            objPrevious = objRow;
        }

        for (let objStale of objExisting.values()) { // items that were removed from the list entirely
            objStale.remove();
        }
    };

    async function funcRender() {
        const objResponse = await funcMessage({ 'strMessage': 'watchlist:list' }) || { 'objActive': [], 'objWatched': [] };
        const strCurrentIdent = (objResponse.strCurrentIdent || '') || null;
        const funcDecorate = function(objItem) {
            return Object.assign({}, objItem, {
                'boolCurrent': (strCurrentIdent !== null) && (objItem.strIdent === strCurrentIdent),
            });
        };
        const objActiveItems = (objResponse.objActive || []).map(funcDecorate);
        const objWatchedItems = (objResponse.objWatched || []).map(funcDecorate);

        funcRenderList(objActive, objActiveItems);
        funcRenderList(objWatched, objWatchedItems);

        objActiveSection.querySelector('.section-title').textContent = 'Watch list (' + objActiveItems.length + ')';
        objWatchedSection.querySelector('.section-title').textContent = 'Watched (' + objWatchedItems.length + ')';

        objActiveSection.classList.toggle('is-visible', objActiveItems.length > 0);
        objWatchedSection.classList.toggle('is-visible', objWatchedItems.length > 0);
        objEmpty.classList.toggle('is-visible', (objActiveItems.length + objWatchedItems.length) === 0);
    }

    const funcStatus = function(strText) {
        objStatus.textContent = strText;

        if (strText !== '') {
            window.setTimeout(function() {
                if (objStatus.textContent === strText) {
                    objStatus.textContent = '';
                }
            }, 3500);
        }
    };

    objAddCurrent.addEventListener('click', async function() {
        objAddCurrent.disabled = true;
        funcStatus('Adding...');

        const objResponse = await funcMessage({ 'strMessage': 'watchlist:add-active' });

        if ((objResponse !== null) && (objResponse.boolAdded === true)) {
            funcStatus('Added to watch list.');
            await funcRender();
        } else {
            funcStatus((objResponse || {}).strReason || 'Could not add this tab.');
        }

        objAddCurrent.disabled = false;
    });

    chrome.storage.onChanged.addListener(function(objChanges, strArea) {
        if ((strArea === 'local') && (objChanges['extensions.Youwatch.Watchlist.objItems'] !== undefined)) {
            funcRender();
        }
    });

    chrome.runtime.onMessage.addListener(function(objRequest) {
        if (objRequest.strMessage === 'watchlist:refresh') {
            funcRender();
        }
    });
    document.addEventListener('click', function() {
        funcCloseMenus();
    });
    document.addEventListener('keydown', function(objEvent) {
        if (objEvent.key === 'Escape') {
            funcCloseMenus();
        }
    });
    funcRender();
})();
