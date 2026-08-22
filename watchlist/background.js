(() => {
    'use strict';

    const strKey = 'extensions.Youwatch.Watchlist.objItems';
    const strSizekey = 'extensions.Youwatch.Watchlist.intSize';
    let objDatabase = null;
    let objDatabasePromise = null;

    const funcNow = function() {
        return new Date().getTime();
    };

    const funcStorageget = async function() {
        return await new Promise(function(funcResolve) {
            chrome.storage.local.get(strKey, function(objValue) {
                let objItems = objValue[strKey];

                if (Array.isArray(objItems) === false) {
                    objItems = [];
                }

                funcResolve(objItems.filter(function(objItem) {
                    return (objItem !== null) && (objItem !== undefined) && (typeof objItem.strIdent === 'string') && (objItem.strIdent.length === 11);
                }));
            });
        });
    };

    const funcStorageset = async function(objItems) {
        const objCurrent = await new Promise(function(funcResolve) {
            chrome.storage.local.get(strKey, function(objValue) {
                funcResolve(objValue[strKey]);
            });
        });

        if (JSON.stringify(objCurrent) === JSON.stringify(objItems)) {
            await new Promise(function(funcResolve) {
                chrome.storage.local.set({ [strSizekey]: objItems.length }, funcResolve);
            });

            return; // nothing actually changed - skip the write so storage.onChanged doesn't fire and refresh the sidebar for no reason
        }

        await new Promise(function(funcResolve) {
            chrome.storage.local.set({ [strKey]: objItems, [strSizekey]: objItems.length }, funcResolve);
        });
    };

    const funcSave = async function(objItems) {
        await funcStorageset(objItems);
    };

    const funcIdent = function(strUrl) {
        try {
            const objUrl = new URL(strUrl || '');

            if (objUrl.hostname === 'youtu.be') {
                const strIdent = objUrl.pathname.split('/').filter(function(strPart) {
                    return strPart !== '';
                })[0] || '';

                return strIdent.length === 11 ? strIdent : null;
            }

            if ((objUrl.hostname !== 'www.youtube.com') && (objUrl.hostname !== 'm.youtube.com') && (objUrl.hostname !== 'youtube.com')) {
                return null;
            }

            if (objUrl.pathname === '/watch') {
                const strIdent = objUrl.searchParams.get('v');
                return ((strIdent || '').length === 11) ? strIdent : null;
            }

            if (objUrl.pathname.indexOf('/shorts/') === 0) {
                const strIdent = objUrl.pathname.split('/shorts/')[1].slice(0, 11);
                return strIdent.length === 11 ? strIdent : null;
            }
        } catch (objError) {
            return null;
        }

        return null;
    };

    const funcKind = function(strUrl) {
        return (strUrl || '').indexOf('/shorts/') !== -1 ? 'shorts' : 'watch';
    };

    const funcWatchurl = function(strIdent, strKind) {
        if (strKind === 'shorts') {
            return 'https://www.youtube.com/shorts/' + strIdent;
        }

        return 'https://www.youtube.com/watch?v=' + strIdent;
    };

    const funcThumb = function(strIdent) {
        return 'https://i.ytimg.com/vi/' + strIdent + '/hqdefault.jpg';
    };

    const strContextmenu = 'watchlist:add-link';

    const funcMenuapi = function() {
        return chrome.menus || chrome.contextMenus || null;
    };

    const funcText = function(strValue) {
        return (strValue || '').replace(/\s+/g, ' ').trim();
    };

    const funcDuration = function(intSeconds) {
        if ((Number.isFinite(intSeconds) === false) || (intSeconds <= 0)) {
            return '';
        }

        const objParts = [];

        while (intSeconds >= 60) {
            objParts.unshift(String(intSeconds % 60).padStart(2, '0'));
            intSeconds = Math.floor(intSeconds / 60);
        }

        objParts.unshift(String(intSeconds));
        return objParts.join(':');
    };

    const funcCompactviews = function(strValue) {
        const intViews = Number(String(strValue || '').replace(/[^\d]/g, ''));

        if ((Number.isFinite(intViews) === false) || (intViews <= 0)) {
            return '';
        }

        return new Intl.NumberFormat(undefined, {
            'maximumFractionDigits': 1,
            'notation': 'compact',
        }).format(intViews) + ' views';
    };

    const funcRelativeDate = function(strValue) {
        const intTimestamp = Date.parse(strValue || '');

        if (Number.isFinite(intTimestamp) === false) {
            return funcText(strValue);
        }

        const intSeconds = Math.max(0, Math.floor((funcNow() - intTimestamp) / 1000));
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

    const funcPlayerResponse = function(strHtml) {
        const intStart = (strHtml || '').indexOf('ytInitialPlayerResponse');

        if (intStart === -1) {
            return null;
        }

        const intBrace = strHtml.indexOf('{', intStart);

        if (intBrace === -1) {
            return null;
        }

        let intDepth = 0;
        let boolString = false;
        let boolEscape = false;

        for (let intIndex = intBrace; intIndex < strHtml.length; intIndex += 1) {
            const strChar = strHtml[intIndex];

            if (boolString === true) {
                if (boolEscape === true) {
                    boolEscape = false;
                } else if (strChar === '\\') {
                    boolEscape = true;
                } else if (strChar === '"') {
                    boolString = false;
                }

                continue;
            }

            if (strChar === '"') {
                boolString = true;
            } else if (strChar === '{') {
                intDepth += 1;
            } else if (strChar === '}') {
                intDepth -= 1;

                if (intDepth === 0) {
                    try {
                        return JSON.parse(strHtml.slice(intBrace, intIndex + 1));
                    } catch (objError) {
                        return null;
                    }
                }
            }
        }

        return null;
    };

    const funcRemoteMetadata = async function(strIdent, strKind) {
        try {
            const objResponse = await fetch(funcWatchurl(strIdent, strKind || 'watch'));

            if (objResponse.ok !== true) {
                return null;
            }

            const objPlayer = funcPlayerResponse(await objResponse.text());
            const objDetails = (objPlayer || {}).videoDetails || {};
            const objMicroformat = (((objPlayer || {}).microformat || {}).playerMicroformatRenderer || {});

            return {
                'strTitle': funcText(objDetails.title || ''),
                'strChannel': funcText(objDetails.author || ''),
                'strViews': funcCompactviews(objDetails.viewCount || ''),
                'strPublished': funcRelativeDate(objMicroformat.publishDate || objMicroformat.uploadDate || ''),
                'strDuration': funcDuration(Number(objDetails.lengthSeconds || 0)),
                'strThumbnail': funcThumb(strIdent),
            };
        } catch (objError) {
            return null;
        }
    };

    const funcOpenSidebar = function() {
        try {
            if ((chrome.sidebarAction !== undefined) && (chrome.sidebarAction.open !== undefined)) {
                const objResult = chrome.sidebarAction.open();

                if ((objResult !== undefined) && (objResult !== null) && (objResult.catch !== undefined)) {
                    objResult.catch(function() {});
                }
            }
        } catch (objError) {
            // Firefox can reject sidebar opens outside direct user gestures.
        }
    };

    const funcActiveTab = async function(objTab) {
        if ((objTab !== undefined) && (objTab !== null) && (objTab.id !== undefined)) {
            return objTab;
        }

        return await new Promise(function(funcResolve) {
            chrome.tabs.query({ 'active': true, 'currentWindow': true }, function(objTabs) {
                funcResolve(objTabs.length > 0 ? objTabs[0] : null);
            });
        });
    };

    const funcCurrentIdent = async function() {
        const objActive = await funcActiveTab();

        if (objActive === null) {
            return null;
        }

        return funcIdent(objActive.url || '');
    };

    const funcTabMetadata = async function(objTab, strIdent) {
        // the browser tab title isn't authoritative: youtube prefixes it with an unread-notifications
        // count (eg "(6) Video Title - YouTube"), so it's only used as a last-resort fallback below,
        // after the content script (DOM/page data) and remote fetch (page data) have had a chance.
        let strTabTitle = (objTab.title || '').replace(/ - YouTube$/, '').replace(/^\(\d+\)\s*/, '').trim();

        let objFallback = {
            'strIdent': strIdent,
            'strUrl': funcWatchurl(strIdent, funcKind(objTab.url || '')),
            'strKind': funcKind(objTab.url || ''),
            'strTitle': '',
            'strChannel': '',
            'strViews': '',
            'strPublished': '',
            'strDuration': '',
            'strThumbnail': funcThumb(strIdent),
            'boolVerified': false,
        };

        try {
            const objMetadata = await new Promise(function(funcResolve) {
                chrome.tabs.sendMessage(objTab.id, { 'strMessage': 'watchlist:collect' }, function(objResponse) {
                    if (chrome.runtime.lastError) {
                        funcResolve(null);
                    } else {
                        funcResolve(objResponse || null);
                    }
                });
            });

            if ((objMetadata !== null) && (objMetadata !== undefined) && (objMetadata.strIdent === strIdent)) {
                objFallback = Object.assign(objFallback, objMetadata);
            }
        } catch (objError) {
            // The content script may not be ready yet; fall back to tab metadata.
        }

        objFallback.strIdent = strIdent;
        objFallback.strKind = objFallback.strKind || funcKind(objTab.url || '');
        objFallback.strUrl = objFallback.strUrl || funcWatchurl(strIdent, objFallback.strKind);
        objFallback.strThumbnail = objFallback.strThumbnail || funcThumb(strIdent);

        if (((objFallback.strTitle || '') === '') || ((objFallback.strChannel || '') === '') || ((objFallback.strDuration || '') === '')) {
            const objRemote = await funcRemoteMetadata(strIdent, objFallback.strKind);

            if (objRemote !== null) {
                for (let strField of ['strTitle', 'strChannel', 'strViews', 'strPublished', 'strDuration', 'strThumbnail']) {
                    if (((objFallback[strField] || '') === '') && ((objRemote[strField] || '') !== '')) {
                        objFallback[strField] = objRemote[strField];
                    }
                }
            }
        }

        objFallback.strTitle = objFallback.strTitle || strTabTitle || 'YouTube video';

        return objFallback;
    };

    const funcUrlMetadata = async function(strUrl) {
        const strIdent = funcIdent(strUrl);

        if (strIdent === null) {
            return null;
        }

        const strKind = funcKind(strUrl);
        let objMetadata = {
            'strIdent': strIdent,
            'strUrl': funcWatchurl(strIdent, strKind),
            'strKind': strKind,
            'strTitle': 'YouTube video',
            'strChannel': '',
            'strViews': '',
            'strPublished': '',
            'strDuration': '',
            'strThumbnail': funcThumb(strIdent),
            'boolVerified': false,
        };

        const objRemote = await funcRemoteMetadata(strIdent, strKind);

        if (objRemote !== null) {
            objMetadata = Object.assign(objMetadata, objRemote);
        }

        return objMetadata;
    };

    const funcExistingDatabase = async function() {
        if (objDatabase !== null) {
            return objDatabase;
        }

        if (objDatabasePromise !== null) {
            return await objDatabasePromise;
        }

        objDatabasePromise = (async function() {
            try {
                if (indexedDB.databases !== undefined) {
                    const objDatabases = await indexedDB.databases();
                    const boolExists = objDatabases.some(function(objItem) {
                        return objItem.name === 'Database';
                    });

                    if (boolExists === false) {
                        objDatabasePromise = null; // the main database may just not be initialized yet - retry next time instead of caching this as permanent
                        return null;
                    }
                }

                const objOpen = await idb.openDB('Database');

                if (objOpen.objectStoreNames.contains('storeDatabase') === false) {
                    objOpen.close();
                    objDatabasePromise = null; // same as above - a mid-upgrade race shouldn't be treated as a permanent absence
                    return null;
                }

                objDatabase = objOpen;
                return objDatabase;
            } catch (objError) {
                objDatabasePromise = null;
                return null;
            }
        })();

        return await objDatabasePromise;
    };

    // reads the main database progress for every watchlisted id in one shared readonly transaction, rather than opening
    // a fresh transaction per item like the previous per-id funcProgress did. a missing state on a stored record is
    // surfaced as watching (and warned about by funcStoredstate) instead of being silently assumed watched.
    const funcProgressmap = async function(objItems) {
        const objMap = {};
        const objOpen = await funcExistingDatabase();

        if (objOpen === null) {
            return objMap;
        }

        try {
            const objTransaction = objOpen.transaction(['storeDatabase'], 'readonly');
            const objIndex = objTransaction.objectStore('storeDatabase').index('strIdent');

            for (let objItem of objItems) {
                const objGet = await objIndex.get(objItem.strIdent);

                if ((objGet === undefined) || (objGet === null)) {
                    continue;
                }

                const strState = funcStoredstate(objGet, 'watchlist-hydrate');

                objMap[objItem.strIdent] = {
                    'boolKnown': true,
                    'strState': strState,
                    'intPercent': strState === 'watched' ? 100 : (objGet.intPercent || 0),
                    'intTimestamp': objGet.intTimestamp || 0,
                    'strTitle': objGet.strTitle || '',
                    'intCount': objGet.intCount || 0,
                };
            }
        } catch (objError) {
            // the main database may be missing or mid-upgrade - whatever we collected so far is used, the rest fall back below
        }

        return objMap;
    };

    const funcHydrate = async function(objItems) {
        let boolChanged = false;
        const intNow = funcNow();
        const objProgressmap = await funcProgressmap(objItems);

        for (let objItem of objItems) {
            const objProgress = objProgressmap[objItem.strIdent];

            objItem.objProgress = objProgress || {
                'boolKnown': false,
                'strState': objItem.intCompletedAt ? 'watched' : 'watching',
                'intPercent': objItem.intCompletedAt ? 100 : 0,
                'intTimestamp': 0,
                'strTitle': '',
                'intCount': 0,
            };

            if ((objItem.objProgress.strState === 'watched') && ((objItem.intCompletedAt || 0) === 0)) {
                objItem.intCompletedAt = intNow;
                boolChanged = true;
            } else if ((objItem.objProgress.boolKnown === true) && (objItem.objProgress.strState !== 'watched') && ((objItem.intCompletedAt || 0) !== 0)) {
                objItem.intCompletedAt = 0;
                boolChanged = true;
            }
        }

        if (boolChanged === true) {
            await funcSave(objItems.map(function(objItem) {
                const objClone = Object.assign({}, objItem);
                delete objClone.objProgress;
                return objClone;
            }));
        }

        return objItems;
    };

    const funcPartition = function(objItems, strCurrentIdent) {
        const objActive = [];
        const objWatched = [];

        for (let objItem of objItems) {
            const objProgress = objItem.objProgress || {};
            const boolWatched = ((objProgress.boolKnown === true) && (objProgress.strState === 'watched')) || ((objProgress.boolKnown !== true) && ((objItem.intCompletedAt || 0) !== 0));

            if (boolWatched === true) {
                objWatched.push(objItem);
            } else {
                objActive.push(objItem);
            }
        }

        objWatched.sort(function(objA, objB) {
            return (objB.intCompletedAt || 0) - (objA.intCompletedAt || 0);
        });

        objActive.sort(function(objA, objB) {
            const intTouchedA = objA.intTouched || objA.intAdded || 0;
            const intTouchedB = objB.intTouched || objB.intAdded || 0;

            if (intTouchedA !== intTouchedB) {
                return intTouchedB - intTouchedA;
            }

            const intWatchingA = ((objA.objProgress || {}).boolKnown === true) ? ((objA.objProgress || {}).intTimestamp || 0) : 0;
            const intWatchingB = ((objB.objProgress || {}).boolKnown === true) ? ((objB.objProgress || {}).intTimestamp || 0) : 0;

            if (intWatchingA !== intWatchingB) {
                return intWatchingB - intWatchingA;
            }

            return (objB.intAdded || 0) - (objA.intAdded || 0);
        });

        if ((strCurrentIdent !== null) && (objActive.length > 1)) {
            const intCurrent = objActive.findIndex(function(objItem) {
                return objItem.strIdent === strCurrentIdent;
            });

            if (intCurrent > 0) {
                const objCurrent = objActive.splice(intCurrent, 1)[0];
                objActive.splice(1, 0, objCurrent);
            }
        }

        return { 'objActive': objActive, 'objWatched': objWatched };
    };

    const funcList = async function() {
        let objItems = await funcStorageget();

        objItems = await funcHydrate(objItems);
        const strCurrentIdent = await funcCurrentIdent();
        const objPartitioned = funcPartition(objItems, strCurrentIdent);

        return Object.assign(objPartitioned, {
            'strCurrentIdent': strCurrentIdent,
        });
    };

    const funcAdd = async function(objMetadata) {
        const intNow = funcNow();
        let objItems = await funcStorageget();
        let objExisting = null;

        objItems = objItems.filter(function(objItem) {
            if (objItem.strIdent === objMetadata.strIdent) {
                objExisting = objItem;
                return false;
            }

            return true;
        });

        const objItem = Object.assign({}, objExisting || {}, objMetadata, {
            'intAdded': (objExisting || {}).intAdded || intNow,
            'intTouched': intNow,
            'intCompletedAt': (objExisting || {}).intCompletedAt || 0,
        });

        for (let strField of ['strChannel', 'strViews', 'strPublished', 'strDuration', 'strThumbnail']) {
            if (((objItem[strField] || '') === '') && (((objExisting || {})[strField] || '') !== '')) {
                objItem[strField] = objExisting[strField];
            }
        }

        objItems.unshift(objItem);
        await funcSave(objItems);
    };

    const funcComplete = async function(objData) {
        if ((objData === null) || (objData === undefined) || (typeof objData.strIdent !== 'string')) {
            return false;
        }

        let boolChanged = false;
        const intNow = objData.intTimestamp || funcNow();
        const objItems = (await funcStorageget()).map(function(objItem) {
            if (objItem.strIdent !== objData.strIdent) {
                return objItem;
            }

            boolChanged = true;
            return Object.assign({}, objItem, {
                'strTitle': objItem.strTitle || objData.strTitle || '',
                'intCompletedAt': objItem.intCompletedAt || intNow,
                'intTouched': funcNow(),
            });
        });

        if (boolChanged === true) {
            await funcSave(objItems);
        }

        return boolChanged;
    };

    globalThis.funcWatchlistCompleted = funcComplete;

    let objIdentcache = null; // the set of watchlisted idents - the hot progress signals ask "is this id on the list" every few seconds, so avoid re-reading the whole list from storage each time

    chrome.storage.onChanged.addListener(function(objChanges, strArea) {
        if ((strArea === 'local') && (objChanges[strKey] !== undefined)) {
            objIdentcache = null;
        }
    });

    globalThis.funcWatchlistHasIdent = async function(strIdent) {
        if (objIdentcache === null) {
            objIdentcache = new Set((await funcStorageget()).map(function(objItem) {
                return objItem.strIdent;
            }));
        }

        return objIdentcache.has(strIdent);
    };

    const funcAddActive = async function(objTab) {
        const objActive = await funcActiveTab(objTab);

        if (objActive === null) {
            return { 'boolAdded': false, 'strReason': 'No active tab found.' };
        }

        const strIdent = funcIdent(objActive.url || '');

        if (strIdent === null) {
            return { 'boolAdded': false, 'strReason': 'Open a YouTube video tab first.' };
        }

        const objMetadata = await funcTabMetadata(objActive, strIdent);
        await funcAdd(objMetadata);

        return { 'boolAdded': true, 'strIdent': strIdent, 'strTitle': objMetadata.strTitle || '' };
    };

    const funcAddUrl = async function(strUrl) {
        const objMetadata = await funcUrlMetadata(strUrl);

        if (objMetadata === null) {
            return { 'boolAdded': false, 'strReason': 'Choose a YouTube video link first.' };
        }

        await funcAdd(objMetadata);

        return { 'boolAdded': true, 'strIdent': objMetadata.strIdent, 'strTitle': objMetadata.strTitle || '' };
    };

    const funcExport = async function(funcProgress) {
        const objItems = (await funcStorageget()).map(function(objItem) {
            const objClone = Object.assign({}, objItem);
            delete objClone.objProgress;
            return objClone;
        });

        if (funcProgress !== undefined) {
            funcProgress({
                'strProgress': 'collected ' + objItems.length + ' videos',
            });
        }

        await funcStorageset(objItems);

        return {
            'objItems': objItems,
        };
    };

    const funcImport = async function(objRequest, funcProgress) {
        if (Array.isArray((objRequest || {}).objItems) === false) {
            return null;
        }

        let intNew = 0;
        let intExisting = 0;
        let objItems = await funcStorageget();
        const intNow = funcNow();

        for (let objImport of objRequest.objItems) {
            if ((objImport === null) || (objImport === undefined) || (typeof objImport.strIdent !== 'string') || (objImport.strIdent.length !== 11)) {
                continue;
            }

            let objExisting = null;

            objItems = objItems.filter(function(objItem) {
                if (objItem.strIdent === objImport.strIdent) {
                    objExisting = objItem;
                    return false;
                }

                return true;
            });

            if (objExisting === null) {
                intNew += 1;
            } else {
                intExisting += 1;
            }

            const objItem = Object.assign({}, objExisting || {}, objImport, {
                'strIdent': objImport.strIdent,
                'strUrl': objImport.strUrl || funcWatchurl(objImport.strIdent, objImport.strKind),
                'strKind': objImport.strKind || funcKind(objImport.strUrl || ''),
                'strThumbnail': objImport.strThumbnail || funcThumb(objImport.strIdent),
                'intAdded': (objExisting || {}).intAdded || objImport.intAdded || intNow,
                'intTouched': intNow,
                'intCompletedAt': (objExisting || {}).intCompletedAt || objImport.intCompletedAt || 0,
            });

            delete objItem.objProgress;

            objItems.unshift(objItem);

            if (funcProgress !== undefined) {
                funcProgress({
                    'strProgress': 'imported ' + (intNew + intExisting) + ' videos - ' + intNew + ' were new',
                });
            }
        }

        await funcSave(objItems);

        return {};
    };

    const funcReset = async function() {
        await funcSave([]);

        return {};
    };

    const funcCreateContextmenu = function() {
        const objMenus = funcMenuapi();

        if ((objMenus === null) || (objMenus.create === undefined)) {
            return;
        }

        objMenus.remove(strContextmenu, function() {
            void chrome.runtime.lastError;

            objMenus.create({
                'id': strContextmenu,
                'title': 'Add to Watchlist',
                'contexts': ['link'],
            }, function() {
                void chrome.runtime.lastError;
            });
        });
    };

    funcCreateContextmenu();

    const objMenus = funcMenuapi();

    if ((objMenus !== null) && (objMenus.onClicked !== undefined)) {
        objMenus.onClicked.addListener(function(objInfo) {
            if (objInfo.menuItemId !== strContextmenu) {
                return;
            }

            funcAddUrl(objInfo.linkUrl || '').then(function(objResponse) {
                if ((objResponse !== null) && (objResponse.boolAdded === true)) {
                    funcOpenSidebar();
                }
            });
        });
    }

    chrome.runtime.onConnect.addListener(function(objPort) {
        if (objPort.name === 'watchlist') {
            objPort.onMessage.addListener(async function(objData) {
                if (objData.strMessage === 'watchlistExport') {
                    objPort.postMessage({
                        'strMessage': 'watchlistExport',
                        'objResponse': await funcExport(function(objResponse) {
                            objPort.postMessage({
                                'strMessage': 'watchlistExport-progress',
                                'objResponse': objResponse,
                            });
                        }),
                    });

                } else if (objData.strMessage === 'watchlistImport') {
                    objPort.postMessage({
                        'strMessage': 'watchlistImport',
                        'objResponse': await funcImport(objData.objRequest, function(objResponse) {
                            objPort.postMessage({
                                'strMessage': 'watchlistImport-progress',
                                'objResponse': objResponse,
                            });
                        }),
                    });

                } else if (objData.strMessage === 'watchlistReset') {
                    objPort.postMessage({
                        'strMessage': 'watchlistReset',
                        'objResponse': await funcReset(),
                    });

                }
            });
        }
    });

    chrome.runtime.onMessage.addListener(function(objRequest, objSender, funcResponse) {
        if (objRequest.strMessage === 'watchlist:list') {
            funcList().then(funcResponse);
            return true;

        } else if (objRequest.strMessage === 'watchlist:add-active') {
            funcAddActive().then(funcResponse);
            return true;

        } else if (objRequest.strMessage === 'watchlist:add-url') {
            funcAddUrl(objRequest.strUrl).then(funcResponse);
            return true;

        } else if (objRequest.strMessage === 'watchlist:remove') {
            funcStorageget().then(function(objItems) {
                return funcSave(objItems.filter(function(objItem) {
                    return objItem.strIdent !== objRequest.strIdent;
                }));
            }).then(function() {
                funcResponse(true);
            });

            return true;

        } else if (objRequest.strMessage === 'watchlist:open') {
            chrome.tabs.create({ 'url': objRequest.strUrl || funcWatchurl(objRequest.strIdent, objRequest.strKind) }, function() {
                funcResponse(true);
            });

            return true;

        } else if (objRequest.strMessage === 'watchlist:completed') {
            funcComplete(objRequest).then(funcResponse);
            return true;
        }

        return false;
    });

    chrome.tabs.onActivated.addListener(function() {
        chrome.runtime.sendMessage({ 'strMessage': 'watchlist:refresh' }, function() {
            void chrome.runtime.lastError;
        });
    });

    chrome.tabs.onUpdated.addListener(function(intTab, objChange) {
        if ((objChange.url === undefined) && (objChange.status !== 'complete')) {
            return;
        }

        chrome.runtime.sendMessage({ 'strMessage': 'watchlist:refresh' }, function() {
            void chrome.runtime.lastError;
        });
    });

    funcStorageget().then(function(objItems) {
        return funcSave(objItems);
    });
})();
