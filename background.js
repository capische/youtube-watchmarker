'use strict';

if (typeof importScripts === 'function') {
    importScripts('idb.js', 'parse.js'); // chrome service worker - firefox loads these through background.scripts instead
}

let funcStorageget = async function(strKey) {
    let objValue = await chrome.storage.local.get(strKey);

    if (objValue[strKey] === undefined) {
        return null;
    }

    return String(objValue[strKey]);
};

let funcStorageset = async function(strKey, objValue) {
     await chrome.storage.local.set({ [strKey]: String(objValue) });
};

// extracts the 11 character video id from a youtube url. parsing the query string (rather than assuming v is the last
// parameter) means urls like /watch?app=desktop&v=xxxxxxxxxxx no longer yield a garbage 11 char slice such as "app=desktop"
let funcIdentfromurl = function(strUrl) {
    try {
        let objUrl = new URL(strUrl);

        if (objUrl.pathname.indexOf('/shorts/') === 0) {
            let strIdent = objUrl.pathname.split('/shorts/')[1].slice(0, 11);
            return (strIdent.length === 11) ? strIdent : null;
        }

        let strIdent = objUrl.searchParams.get('v') || '';
        return (strIdent.length === 11) ? strIdent : null;
    } catch (objError) {
        return null;
    }
};

let funcNormalizedyoutubetitle = function(strTitle) {
    strTitle = strTitle || '';

    if (strTitle.slice(-10) === ' - YouTube') {
        strTitle = strTitle.slice(0, -10);
    }

    // youtube prefixes the tab title with an unread-notifications count (eg "(6) Video Title"),
    // which isn't part of the actual video title
    return strTitle.replace(/^\(\d+\)\s*/, '').trim();
};

let funcBroadcast = function(objResult) { // push the resulting state to every open youtube tab so the marks update live
    if ((objResult === null) || (objResult === undefined)) {
        return;
    }

    chrome.tabs.query({
        'url': '*://*.youtube.com/*'
    }, function(objTabs) {
        for (let objTab of objTabs) {
            chrome.tabs.sendMessage(objTab.id, {
                'strMessage': 'youtubeMark',
                'strIdent': objResult.strIdent,
                'intTimestamp': objResult.intTimestamp,
                'strTitle': objResult.strTitle,
                'strState': objResult.strState,
                'intPercent': objResult.intPercent,
                'intCount': objResult.intCount,
            });
        }
    });
};

let funcBroadcastforget = function(objResult) { // remove local marks from every open youtube tab after a local-only delete
    if ((objResult === null) || (objResult === undefined)) {
        return;
    }

    chrome.tabs.query({
        'url': '*://*.youtube.com/*'
    }, function(objTabs) {
        for (let objTab of objTabs) {
            chrome.tabs.sendMessage(objTab.id, {
                'strMessage': 'youtubeForget',
                'strIdent': objResult.strIdent,
            });
        }
    });
};

let funcNotifywatchlist = async function(objResult) { // tell the sidebar to refresh when watch progress changes for a video that's on the watchlist
    if ((objResult === null) || (objResult === undefined)) {
        return;
    }

    if (typeof globalThis.funcWatchlistHasIdent !== 'function') {
        return;
    }

    if (await globalThis.funcWatchlistHasIdent(objResult.strIdent) !== true) {
        return; // avoid spamming the sidebar with a refresh for every video played, watchlisted or not
    }

    chrome.runtime.sendMessage({ 'strMessage': 'watchlist:refresh' }, function() {
        void chrome.runtime.lastError; // the sidebar may not be open
    });
};

let funcMarktabopen = async function(objTab, strTitle) {
    if ((objTab === undefined) || (objTab === null) || ((objTab.url || '').indexOf('.youtube.com') === -1)) {
        return;
    }

    if (await funcStorageget('extensions.Youwatch.Condition.boolBrownav') !== String(true)) {
        return;
    }

    if (((objTab.url || '').indexOf('.youtube.com/watch?v=') === -1) && ((objTab.url || '').indexOf('.youtube.com/shorts/') === -1)) {
        return;
    }

    let strIdent = funcIdentfromurl(objTab.url || '');
    strTitle = funcNormalizedyoutubetitle(strTitle || objTab.title || '');

    // background-tab opens do not reliably surface a title delta in tabs.onUpdated, so fall back to the current tab
    // title on the completion event instead of silently skipping the "opened here" watching mark.
    if ((strIdent === null) || (strTitle === '')) {
        return;
    }

    let objResult = await Youtube.mark({
        'strIdent': strIdent,
        'strTitle': strTitle,
        'strState': 'watching',
        'boolOpened': true,
        'boolEnsure': true,
        'strSource': 'tab-open',
    });

    funcBroadcast(objResult);
    funcNotifywatchlist(objResult);
};

let objThemes = { // the visual look of the marks - each theme supplies the stylesheet strings used when rendering them
    'orange': {
        'strFadeout': '.youwatch-watched img.ytCoreImageHost, .youwatch-watched .ytp-videowall-still-image { opacity:0.3; transition:filter 0.25s ease-in-out, opacity 0.25s ease-in-out; } .youwatch-watched:hover img.ytCoreImageHost, .youwatch-watched:hover .ytp-videowall-still-image, .youwatch-watched:hover video, .youwatch-watched.youwatch-hover img.ytCoreImageHost, .youwatch-watched.youwatch-hover .ytp-videowall-still-image, .youwatch-watched.youwatch-hover video { opacity:1.0; }',
        'strGrayout': '.youwatch-watched img.ytCoreImageHost, .youwatch-watched .ytp-videowall-still-image { filter:grayscale(1.0); transition:filter 0.25s ease-in-out, opacity 0.25s ease-in-out; } .youwatch-watched:hover img.ytCoreImageHost, .youwatch-watched:hover .ytp-videowall-still-image, .youwatch-watched:hover video, .youwatch-watched.youwatch-hover img.ytCoreImageHost, .youwatch-watched.youwatch-hover .ytp-videowall-still-image, .youwatch-watched.youwatch-hover video { filter:none; }',
        'strShowbadge': '.youwatch-watched > .youwatch-thumbnail-label { align-items:center; background-color:rgba(0,0,0,0.7); border-radius:4px; color:#FFFFFF; display:flex !important; font-family:Roboto, Arial, sans-serif; font-size:12px; font-weight:500; gap:0; line-height:18px; padding:1px 4px; }',
        'strShowwatching': '.youwatch-watching { position:relative; border-radius:12px; overflow:hidden; } .youwatch-watching > .youwatch-thumbnail-label { align-items:center; background-color:rgba(0,0,0,0.7); border-radius:4px; color:#FFFFFF; display:flex !important; font-family:Roboto, Arial, sans-serif; font-size:12px; font-weight:500; gap:0; line-height:18px; padding:1px 4px; } .youwatch-watching::before { background-color:#ff8f00; top:0px; content:""; height:3px; left:0px; position:absolute; width:var(--youwatch-percent, 0%); z-index:3; }',
        'strShowcount': '.youwatch-watched[watchcount]:not([watchcount="0"]):not([watchcount="1"]) > .youwatch-thumbnail-label > :is(.youwatch-thumbnail-icon, .youwatch-thumbnail-count, .youwatch-thumbnail-separator), .youwatch-watching[watchcount]:not([watchcount="0"]) > .youwatch-thumbnail-label > :is(.youwatch-thumbnail-icon, .youwatch-thumbnail-count, .youwatch-thumbnail-separator) { display:block !important; }',
        'strShowactive': '.youwatch-active-label { align-items:center; background-color:rgba(0,0,0,0.6); border-radius:999px; color:#EEEEEE; display:flex; font-family:"YouTube Noto", Roboto, Arial, Helvetica, sans-serif; font-size:14px; font-weight:500; gap:1px; line-height:1; padding:10px 16px; white-space:nowrap; } .youwatch-active-icon { -webkit-text-stroke:0.3px currentColor; font-size:1.4125em; line-height:1; transform:translateY(-0.0867em); }',
    },
    'bw': { // black and white - grayscale on watched, watching keeps its colour with a light fade, both wear youtube-style badges
        'strFadeout': '.youwatch-watched img.ytCoreImageHost, .youwatch-watched .ytp-videowall-still-image { opacity:0.3; transition:filter 0.25s ease-in-out, opacity 0.25s ease-in-out; } .youwatch-watching img.ytCoreImageHost, .youwatch-watching .ytp-videowall-still-image { opacity:0.7; transition:filter 0.25s ease-in-out, opacity 0.25s ease-in-out; } .youwatch-watched:hover img.ytCoreImageHost, .youwatch-watched:hover .ytp-videowall-still-image, .youwatch-watched:hover video, .youwatch-watching:hover img.ytCoreImageHost, .youwatch-watching:hover .ytp-videowall-still-image, .youwatch-watching:hover video, .youwatch-watched.youwatch-hover img.ytCoreImageHost, .youwatch-watched.youwatch-hover .ytp-videowall-still-image, .youwatch-watched.youwatch-hover video, .youwatch-watching.youwatch-hover img.ytCoreImageHost, .youwatch-watching.youwatch-hover .ytp-videowall-still-image, .youwatch-watching.youwatch-hover video { opacity:1.0; }',
        'strGrayout': '.youwatch-watched img.ytCoreImageHost, .youwatch-watched .ytp-videowall-still-image { filter:grayscale(1.0); transition:filter 0.25s ease-in-out, opacity 0.25s ease-in-out; } .youwatch-watched:hover img.ytCoreImageHost, .youwatch-watched:hover .ytp-videowall-still-image, .youwatch-watched:hover video, .youwatch-watched.youwatch-hover img.ytCoreImageHost, .youwatch-watched.youwatch-hover .ytp-videowall-still-image, .youwatch-watched.youwatch-hover video { filter:none; }',
        'strShowbadge': '.youwatch-watched > .youwatch-thumbnail-label { align-items:center; background-color:rgba(0,0,0,0.7); border-radius:4px; color:#FFFFFF; display:flex !important; font-family:Roboto, Arial, sans-serif; font-size:12px; font-weight:500; gap:0; line-height:18px; padding:1px 4px; }',
        'strShowwatching': '.youwatch-watching { position:relative; border-radius:12px; overflow:hidden; } .youwatch-watching > .youwatch-thumbnail-label { align-items:center; background-color:rgba(0,0,0,0.7); border-radius:4px; color:#FFFFFF; display:flex !important; font-family:Roboto, Arial, sans-serif; font-size:12px; font-weight:500; gap:0; line-height:18px; padding:1px 4px; }',
        'strShowcount': '.youwatch-watched[watchcount]:not([watchcount="0"]):not([watchcount="1"]) > .youwatch-thumbnail-label > :is(.youwatch-thumbnail-icon, .youwatch-thumbnail-count, .youwatch-thumbnail-separator), .youwatch-watching[watchcount]:not([watchcount="0"]) > .youwatch-thumbnail-label > :is(.youwatch-thumbnail-icon, .youwatch-thumbnail-count, .youwatch-thumbnail-separator) { display:block !important; }',
        'strShowactive': '.youwatch-active-label { align-items:center; background-color:rgba(0,0,0,0.6); border-radius:999px; color:#EEEEEE; display:flex; font-family:"YouTube Noto", Roboto, Arial, Helvetica, sans-serif; font-size:14px; font-weight:500; gap:1px; line-height:1; padding:10px 16px; white-space:nowrap; } .youwatch-active-icon { -webkit-text-stroke:0.3px currentColor; font-size:1.4125em; line-height:1; transform:translateY(-0.0867em); }',
    },
};

let funcApplytheme = async function(strTheme) { // refresh the stylesheet strings from a theme, unless a string was manually customized (carries a 'do not modify' marker)
    if (objThemes.hasOwnProperty(strTheme) === false) {
        strTheme = 'bw';
    }

    await funcStorageset('extensions.Youwatch.Visualization.strTheme', strTheme);

    for (let strKey of ['strFadeout', 'strGrayout', 'strShowbadge', 'strShowwatching', 'strShowcount', 'strShowactive']) {
        let strCurrent = await funcStorageget('extensions.Youwatch.Stylesheet.' + strKey);

        if ((strCurrent === null) || (strCurrent.indexOf('do not modify') === -1)) {
            await funcStorageset('extensions.Youwatch.Stylesheet.' + strKey, objThemes[strTheme][strKey]);
        }
    }
};

let funcDebugmark = function(strEvent, objVideo, objContext) {
    console.debug('[YWM mark] ' + strEvent, {
        'strIdent': objVideo.strIdent || '',
        'strTitle': objVideo.strTitle || '',
        'strSource': objVideo.strSource || 'unknown',
        'strReason': objContext.strReason || '',
        'boolNew': objContext.boolNew === true,
        'boolStored': objContext.boolStored === true,
        'strStateold': objContext.strStateold || '',
        'strStatenew': objContext.strStatenew || '',
        'strStaterequested': objVideo.strState || '',
        'intPercentrequested': (objVideo.intPercent === undefined) ? null : objVideo.intPercent,
        'intPercentstored': (objContext.intPercentstored === undefined) ? null : objContext.intPercentstored,
        'intCountincrement': objContext.intCountincrement || 0,
        'boolAssumed': objVideo.boolAssumed === true,
        'boolOpened': objVideo.boolOpened === true,
        'boolOpenedstored': objContext.boolOpened === true,
        'boolResume': objVideo.boolResume === true,
        'boolCompleted': objVideo.boolCompleted === true,
        'boolConfirmed': objVideo.boolConfirmed === true,
        'boolConfirmedstored': objContext.boolConfirmed === true,
        'boolEnsure': objVideo.boolEnsure === true,
        'intTimestamprequested': objVideo.intTimestamp || null,
    });
};

// merges one video into the store and applies the watching/watched state rules
// - boolConfirmed: the threshold was reached locally (a real completion here) - this is sticky and never demoted
// - boolOpened: the video was opened/played in this browser with the extension active, so its live progress is authoritative
// - boolAssumed: the video showed up in the watch history (watched elsewhere) - the resume bar (red line) percentage decides
//   how far it was watched: a reading below the threshold is watching, anything else (full bar, no bar at all such as a short
//   or a fully watched video, or browser history) counts as watched
// - boolResume: a live reading taken right after opening - a resume from the middle overturns an assumed (not confirmed) watched
// - intCount counts completed views: a brand new record is 1 if it arrives already watched else 0, an existing record
//   gains +1 on a live completion (boolCompleted) or the first time it becomes watched
let funcRecord = async function(objStore, objVideo) {
    let strIdent = objVideo.strIdent || '';

    let objGet = await objStore.index('strIdent').get(strIdent);
    let boolNew = (objGet === undefined) || (objGet === null);

    let strStateold = boolNew ? 'watching' : funcStoredstate(objGet, 'record-existing'); // a stored record missing its state is treated as watching (and warned about) rather than silently assumed watched
    let boolOpenedold = (boolNew === false) && (objGet.boolOpened === true);
    let boolConfirmedold = (boolNew === false) && (objGet.boolConfirmed === true);

    let boolOpened = boolOpenedold || (objVideo.boolOpened === true);
    let boolConfirmed = boolConfirmedold || (objVideo.boolCompleted === true) || (objVideo.boolConfirmed === true);

    let strState = null;
    let strReason = '';

    // a fresh sub-threshold reading - whether real playback resuming from early, or the history page's own resume bar -
    // overturns even a previously confirmed/sticky watched mark: real evidence of an incomplete watch beats an old confirmation
    // a short is exempt: one completed play is final, and its natural loop restarts (or a re-open) would otherwise read as a resume
    let boolLiveresume = (objVideo.boolShorts !== true) && (strStateold === 'watched') && (objVideo.boolCompleted !== true) && (objVideo.boolConfirmed !== true) && (objVideo.strState !== 'watched') && (
        (((objVideo.boolResume === true) || (objVideo.boolOpened === true)) && ((objVideo.intPercent || 0) >= 5))
        || ((objVideo.boolAssumed === true) && (objVideo.intPercent !== undefined) && (objVideo.intPercent !== null))
    );

    if (boolLiveresume === true) {
        strState = 'watching';
        boolConfirmed = false; // the fresh evidence overturns the previous confirmation, sticky or not
        strReason = 'a fresh sub-threshold reading showed the previous watched mark, even a confirmed one, was not accurate';

    } else if (boolConfirmed === true) {
        strState = 'watched'; // a confirmed local completion is final
        strReason = (objVideo.boolCompleted === true) ? 'local player crossed the watched threshold' : 'manual or previous confirmed watched mark is sticky';

    } else if (objVideo.boolAssumed === true) {
        if (objVideo.strState === 'watched') {
            strState = 'watched'; // finished elsewhere with a full (or 100%) resume bar - accept it even if we opened it here before
            strReason = 'assumed source reported watched';

        } else if ((objVideo.intPercent !== undefined) && (objVideo.intPercent !== null)) {
            strState = 'watching'; // a fresh resume-bar reading below the threshold - only partially watched elsewhere
            strReason = 'assumed source had a sub-threshold resume bar';

        } else if (boolOpened === true) {
            strState = strStateold; // opened and tracked here, local state wins when there is no fresh progress reading
            strReason = 'assumed history signal without progress ignored because local opened state wins';

        } else {
            // no progress reading at all (eg the history parse could not find a resume bar). instead of silently
            // assuming watched, surface a new entry as watching so the anomaly is visible and reversible; an existing
            // entry keeps whatever state it already had. the caller (Youtube.synchronize) warns for this case.
            strState = boolNew ? 'watching' : strStateold;
            strReason = boolNew ? 'new assumed entry had no progress reading, so it was treated as watching' : 'assumed entry had no progress reading, so existing state was kept';

        }

    } else {
        strState = ((strStateold === 'watched') || (objVideo.strState === 'watched')) ? 'watched' : 'watching';
        strReason = (strState === 'watched') ? 'existing or requested state was watched' : 'no watched signal was present';

    }

    let intInc = 0;

    if (boolNew === false) {
        if (objVideo.boolCompleted === true) {
            intInc = 1; // a fresh live completion, including re-watches of an already watched video

        } else if ((strStateold !== 'watched') && (strState === 'watched') && ((objGet.intCount || 0) === 0)) {
            intInc = 1; // only the first promotion counts; later re-watches need a confirmed live completion

        }
    }

    let intPercent = null;

    if (strState === 'watched') {
        intPercent = 100; // a watched video has by definition been seen in full

    } else if ((objVideo.intPercent !== undefined) && (objVideo.intPercent !== null)) {
        intPercent = objVideo.intPercent; // the freshest progress reading wins

    } else {
        intPercent = boolNew ? 0 : (objGet.intPercent || 0);

    }

    let objResult = {
        'strIdent': strIdent,
        'intTimestamp': Math.max(boolNew ? 0 : (objGet.intTimestamp || 0), objVideo.intTimestamp || 0) || new Date().getTime(),
        'strTitle': (boolNew ? '' : (objGet.strTitle || '')) || objVideo.strTitle || '',
        'strState': strState,
        'intPercent': Math.max(0, Math.min(100, intPercent)),
        'intCount': boolNew ? (strState === 'watched' ? 1 : 0) : ((objGet.intCount || 0) + intInc),
        'boolOpened': boolOpened,
        'boolConfirmed': boolConfirmed,
        'strDebugSource': objVideo.strSource || (boolNew ? '' : (objGet.strDebugSource || '')),
        'strDebugReason': strReason,
        'intDebugTimestamp': new Date().getTime(),
    };

    if (objResult.strState === 'watched') {
        funcDebugmark('watched decision', objVideo, {
            'strReason': strReason,
            'boolNew': boolNew,
            'boolStored': !((strIdent.trim() === '') || (objResult.strTitle.trim() === '')),
            'strStateold': strStateold,
            'strStatenew': strState,
            'intPercentstored': objResult.intPercent,
            'intCountincrement': intInc,
            'boolOpened': boolOpened,
            'boolConfirmed': boolConfirmed,
        });
    }

    if ((strIdent.trim() === '') || (objResult.strTitle.trim() === '')) {
        return {
            'objResult': objResult,
            'boolNew': boolNew,
            'boolStored': false,
        };
    }

    await objStore.put(objResult);

    return {
        'objResult': objResult,
        'boolNew': boolNew,
        'boolStored': true,
    };
};

let funcYoufetch = async function(strLink, objPayload, objContext, strClicktrack) {
    let funcCookie = async function(strCookie) {
        let objCookie = await chrome.cookies.get({
            'url': 'https://www.youtube.com',
            'name': strCookie,
        });

        if (objCookie === null) {
            return null;
        }

        return objCookie.value;
    };

    let intTime = Math.round(new Date().getTime() / 1000.0);
    let strCookie = await funcCookie('SAPISID') || await funcCookie('__Secure-3PAPISID');
    let strOrigin = 'https://www.youtube.com';
    let strHash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(intTime + ' ' + strCookie + ' ' + strOrigin)); // https://stackoverflow.com/a/32065323
    let strAuth = 'SAPISIDHASH ' + intTime + '_' + Array.from(new Uint8Array(strHash)).map(function(intByte) { return intByte.toString(16).padStart(2, '0'); }).join('');

    objContext['client']['acceptHeader'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    objContext['client']['screenWidthPoints'] = 1629;
    objContext['client']['screenHeightPoints'] = 1312;
    objContext['client']['screenPixelDensity'] = 1;
    objContext['client']['screenDensityFloat'] = 1;
    objContext['client']['utcOffsetMinutes'] = -420;
    objContext['client']['userInterfaceTheme'] = 'USER_INTERFACE_THEME_LIGHT';
    objContext['client']['mainAppWebInfo'] = {
        'graftUrl': 'https://www.youtube.com/feed/history',
        'pwaInstallabilityStatus': 'PWA_INSTALLABILITY_STATUS_UNKNOWN',
        'webDisplayMode': 'WEB_DISPLAY_MODE_BROWSER',
        'isWebNativeShareAvailable': false,
    };

    objContext['request']['internalExperimentFlags'] = [];
    objContext['request']['consistencyTokenJars'] = [];

    return await fetch(strLink, {
        'method': 'POST',
        'credentials': 'include',
        'headers': {
            'Authorization': strAuth,
            'Content-Type': 'application/json',
            'X-Origin': 'https://www.youtube.com',
            'X-Goog-AuthUser': '0',
            'X-Goog-Visitor-Id': objContext['client']['visitorData'],
            'X-Youtube-Bootstrap-Logged-In': true,
            'X-Youtube-Client-Name': 1,
            'X-Youtube-Client-Version': objContext['client']['clientVersion'],
        },
        'body': JSON.stringify({
            'context': {
                'client': objContext['client'],
                'user': {
                    'lockedSafetyMode': false,
                },
                'request': objContext['request'],
                'clickTracking': {
                    'clickTrackingParams': strClicktrack,
                },
                'adSignalsInfo': {
                    'params': [{
                        'key': 'dt',
                        'value': String(new Date().getTime()),
                    }, {
                        'key': 'flash',
                        'value': '0',
                    }, {
                        'key': 'frm',
                        'value': '0',
                    }, {
                        'key': 'u_tz',
                        'value': '-420',
                    }, {
                        'key': 'u_his',
                        'value': '3',
                    }, {
                        'key': 'u_h',
                        'value': '2160',
                    }, {
                        'key': 'u_w',
                        'value': '3840',
                    }, {
                        'key': 'u_ah',
                        'value': '2112',
                    }, {
                        'key': 'u_aw',
                        'value': '3840',
                    }, {
                        'key': 'u_cd',
                        'value': '24',
                    }, {
                        'key': 'bc',
                        'value': '31',
                    }, {
                        'key': 'bih',
                        'value': '1312',
                    }, {
                        'key': 'biw',
                        'value': '1629',
                    }, {
                        'key': 'brdim',
                        'value': '-20,-20,-20,-20,3840,0,1960,2152,1629,1312',
                    }, {
                        'key': 'vis',
                        'value': '1',
                    }, {
                        'key': 'wgl',
                        'value': 'true',
                    }, {
                        'key': 'ca_type',
                        'value': 'image',
                    }],
                },
            },
            ...objPayload,
        })
    });
};

// funcHackyparse, funcParsevideos and funcPercent live in the shared parse.js (loaded before this file) so the
// service worker and the page-world hooks.js content script stay in sync instead of drifting apart as copies.

// pulls the per-video "remove from watch history" tokens out of a parsed lockupViewModel, or null when it carries none
let funcDeletetokens = function(objVideo) {
    try {
        for (let objItem of objVideo['lockupViewModel']['metadata']['lockupMetadataViewModel']['menuButton']['buttonViewModel']['onTap']['innertubeCommand']['showSheetCommand']['panelLoadingStrategy']['inlineContent']['sheetViewModel']['content']['listViewModel']['listItems']) {
            if (JSON.stringify(objItem).indexOf('"DELETE"') !== -1) {
                return {
                    'strClicktrack': objItem['listItemViewModel']['rendererContext']['commandContext']['onTap']['innertubeCommand']['clickTrackingParams'],
                    'strFeedback': objItem['listItemViewModel']['rendererContext']['commandContext']['onTap']['innertubeCommand']['feedbackEndpoint']['feedbackToken'],
                };
            }
        }
    } catch (objError) {
        // the entry is an older renderer without this menu - it carries no usable delete token
    }

    return null;
};

// caches the youtube watch history pages across deletions so repeated deletes reuse the already fetched token map;
// kept short lived since the history changes over time and the feedback tokens should not be relied on for long
let objHistorycache = null; // { intTimestamp, objContext, objTokens: { strIdent: { strClicktrack, strFeedback } }, strContinuation, strClicktrack, intPages, boolExhausted }
let intHistorycachettl = 300000; // 5 minutes

// ##########################################################

let Database = {
    objDatabase: null,

    init: async function() {
        Database.objDatabase = await idb.openDB('Database', 402, {
            'upgrade': function(objDatabase, intVerold, intVernew, objTransaction, objEvent) {
                let objStore = null;

                if (objDatabase.objectStoreNames.contains('storeDatabase') === true) {
                    objStore = objTransaction.objectStore('storeDatabase');

                } else {
                    objStore = objDatabase.createObjectStore('storeDatabase', {
                        'keyPath': 'strIdent',
                    });

                }

                if (objStore.indexNames.contains('strIdent') === false) {
                    objStore.createIndex('strIdent', 'strIdent', {
                        'unique': true,
                    });
                }

                if (objStore.indexNames.contains('intTimestamp') === false) {
                    objStore.createIndex('intTimestamp', 'intTimestamp', {
                        'unique': false,
                    });
                }

                if (objStore.indexNames.contains('strState') === false) {
                    objStore.createIndex('strState', 'strState', {
                        'unique': false,
                    });
                }
            }
        });

        chrome.runtime.onConnect.addListener(function(objPort) {
            if (objPort.name === 'database') {
                objPort.onMessage.addListener(async function(objData) {
                    if (objData.strMessage === 'databaseExport') {
                        objPort.postMessage({
                            'strMessage': 'databaseExport',
                            'objResponse': await Database.export(objData.objRequest, function(objResponse) {
                                objPort.postMessage({
                                    'strMessage': 'databaseExport-progress',
                                    'objResponse': objResponse,
                                });
                            })
                        });

                    } else if (objData.strMessage === 'databaseImport') {
                        objPort.postMessage({
                            'strMessage': 'databaseImport',
                            'objResponse': await Database.import(objData.objRequest, function(objResponse) {
                                objPort.postMessage({
                                    'strMessage': 'databaseImport-progress',
                                    'objResponse': objResponse,
                                });
                            })
                        });
                        ;

                    } else if (objData.strMessage === 'databaseReset') {
                        objPort.postMessage({
                            'strMessage': 'databaseReset',
                            'objResponse': await Database.reset(objData.objRequest),
                        });

                    }
                });
            }
        });
    },

    export: async function(objRequest, funcProgress) {
        let objVideos = [];
        let objTransaction = Database.objDatabase.transaction(['storeDatabase'], 'readonly');
        let objDatabase = objTransaction.objectStore('storeDatabase');
        let objCursor = await objDatabase.openCursor();

        while (objCursor) {
            objVideos.push({
                'strIdent': objCursor.value.strIdent,
                'intTimestamp': objCursor.value.intTimestamp,
                'strTitle': objCursor.value.strTitle,
                'strState': funcStoredstate(objCursor.value, 'database-export'),
                'intPercent': objCursor.value.intPercent,
                'intCount': objCursor.value.intCount,
                'boolOpened': objCursor.value.boolOpened === true,
                'boolConfirmed': objCursor.value.boolConfirmed === true,
            });

            funcProgress({
                'strProgress': 'collected ' + objVideos.length + ' videos',
            });

            objCursor = await objCursor.continue();
        }

        return {
            'objVideos': objVideos,
        };
    },

    import: async function(objRequest, funcProgress) {
        if (Array.isArray((objRequest || {}).objVideos) === false) {
            return null;
        }

        let intNew = 0;
        let intExisting = 0;

        let objTransaction = Database.objDatabase.transaction(['storeDatabase'], 'readwrite');
        let objDatabase = objTransaction.objectStore('storeDatabase');

        for (let objVideo of objRequest.objVideos) {
            let objGet = await objDatabase.index('strIdent').get(objVideo.strIdent);
            let boolNew = (objGet === undefined) || (objGet === null);

            if (boolNew === true) {
                intNew += 1;

            } else if (boolNew === false) {
                intExisting += 1;

            }

            await funcRecord(objDatabase, {
                'strIdent': objVideo.strIdent,
                'intTimestamp': objVideo.intTimestamp,
                'strTitle': objVideo.strTitle,
                'strState': funcStoredstate(objVideo, 'database-import'), // a well-formed export always carries a state; a missing one is surfaced as watching (and warned about) instead of assumed watched
                'intPercent': objVideo.intPercent,
                'intCount': objVideo.intCount,
                'boolOpened': objVideo.boolOpened === true,
                'boolConfirmed': objVideo.boolConfirmed === true,
                'strSource': 'database-import',
            });

            // imports carry an explicit historical count so preserve the larger of the two
            if ((objVideo.intCount !== undefined) && (objVideo.intCount !== null)) {
                let objMerged = await objDatabase.index('strIdent').get(objVideo.strIdent);

                if ((objMerged !== undefined) && (objMerged !== null) && (objVideo.intCount > objMerged.intCount)) {
                    objMerged.intCount = objVideo.intCount;

                    await objDatabase.put(objMerged);
                }
            }

            funcProgress({
                'strProgress': 'imported ' + (intNew + intExisting) + ' videos - ' + intNew + ' were new',
            });
        }

        await funcStorageset('extensions.Youwatch.Database.intSize', await objDatabase.count());

        await objTransaction.done;

        return {};
    },

    reset: async function(objRequest) {
        let objTransaction = Database.objDatabase.transaction(['storeDatabase'], 'readwrite');
        let objDatabase = objTransaction.objectStore('storeDatabase');

        await objDatabase.clear();

        await funcStorageset('extensions.Youwatch.Database.intSize', await objDatabase.count());

        await objTransaction.done;

        return {};
    }
};

let History = {
    init: function() {
        chrome.runtime.onConnect.addListener(function(objPort) {
            if (objPort.name === 'history') {
                objPort.onMessage.addListener(async function(objData) {
                    if (objData.strMessage === 'historySynchronize') {
                        if (await funcStorageget('extensions.Youwatch.Condition.boolBrowhist') !== String(true)) {
                            objPort.postMessage({
                                'strMessage': 'historySynchronize',
                                'objResponse': {
                                    'boolPaused': true,
                                },
                            });

                            return;
                        }

                        objPort.postMessage({
                            'strMessage': 'historySynchronize',
                            'objResponse': await History.synchronize(objData.objRequest, function(objResponse) {
                                objPort.postMessage({
                                    'strMessage': 'historySynchronize-progress',
                                    'objResponse': objResponse,
                                });
                            }),
                        });
                    }
                });
            }
        });
    },

    synchronize: async function(objRequest, funcProgress) {
        let intNew = 0;
        let intExisting = 0;

        let objHistory = await chrome.history.search({
            'text': 'youtube.com',
            'startTime': objRequest.intTimestamp,
            'maxResults': 1000000,
        });

        let objTransaction = Database.objDatabase.transaction(['storeDatabase'], 'readwrite');
        let objDatabase = objTransaction.objectStore('storeDatabase');

        for (let objEntry of objHistory) {
            if ((objEntry.url.indexOf('.youtube.com/watch?v=') === -1) && (objEntry.url.indexOf('.youtube.com/shorts/') === -1)) {
                continue;

            } else if ((objEntry.title === undefined) || (objEntry.title === null)) {
                continue;

            }

            let strIdent = objEntry.url.split('&')[0].slice(-11);
            let intTimestamp = objEntry.lastVisitTime;
            let strTitle = funcNormalizedyoutubetitle(objEntry.title);

            let objGet = await objDatabase.index('strIdent').get(strIdent);

            if ((objGet === undefined) || (objGet === null)) {
                intNew += 1;

            } else if ((objGet !== undefined) && (objGet !== null)) {
                intExisting += 1;

            }

            let boolOpened = (objGet !== undefined) && (objGet !== null) && (objGet.boolOpened === true);

            // the browser history only proves the page was opened. if the extension already tracked that local open,
            // keep it watching until player progress or a stronger youtube-history signal proves completion.
            await funcRecord(objDatabase, {
                'strIdent': strIdent,
                'intTimestamp': intTimestamp,
                'strTitle': strTitle,
                'strState': boolOpened === true ? 'watching' : 'watched',
                'boolAssumed': true,
                'strSource': 'browser-history-import',
            });

            funcProgress({
                'strProgress': 'imported ' + (intNew + intExisting) + ' videos - ' + intNew + ' were new',
            });
        }

        await funcStorageset('extensions.Youwatch.Database.intSize', await objDatabase.count());
        await funcStorageset('extensions.Youwatch.History.intTimestamp', new Date().getTime());

        await objTransaction.done;

        return {};
    }
};

let Youtube = {
    strTitlecache: {},

    init: function() {
        chrome.runtime.onConnect.addListener(function(objPort) {
            if (objPort.name === 'youtube') {
                objPort.onMessage.addListener(async function(objData) {
                    if (objData.strMessage === 'youtubeSynchronize') {
                        objPort.postMessage({
                            'strMessage': 'youtubeSynchronize',
                            'objResponse': await Youtube.synchronize(objData.objRequest, function(objResponse) {
                                objPort.postMessage({
                                    'strMessage': 'youtubeSynchronize-progress',
                                    'objResponse': objResponse,
                                });
                            }),
                        });

                    } else if (objData.strMessage === 'youtubeLookup') {
                        objPort.postMessage({
                            'strMessage': 'youtubeLookup',
                            'objResponse': await Youtube.lookup(objData.objRequest),
                        });

                    } else if (objData.strMessage === 'youtubeMark') {
                        objPort.postMessage({
                            'strMessage': 'youtubeMark',
                            'objResponse': await Youtube.mark(objData.objRequest),
                        });

                    }
                });
            }
        });
    },

    synchronize: async function(objRequest, funcProgress) {
        let intNew = 0;
        let intExisting = 0;

        let intThreshold = parseInt(await funcStorageget('extensions.Youwatch.Condition.intThreshold')) || 99;

        let objContext = null;
        let strClicktrack = null;
        let strContinuation = null;

        while (true) {
            let objFetch = null;

            if ((objContext === null) || (strClicktrack === null) || (strContinuation === null)) {
                objFetch = await fetch('https://www.youtube.com/feed/history', {
                    'method': 'GET',
                    'credentials': 'include',
                });

            } else if ((objContext !== null) && (strClicktrack !== null) && (strContinuation !== null)) {
                objFetch = await funcYoufetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { 'continuation': strContinuation }, objContext, strClicktrack);

                strContinuation = null;

            }

            let strResponse = await objFetch.text();

            if (objContext === null) {
                objContext = funcHackyparse(strResponse.split('"INNERTUBE_CONTEXT":')[1]);
            }

            let strRegex = null;
            let objClicktrack = new RegExp('"continuationEndpoint":[^"]*"clickTrackingParams":[^"]*"([^"]*)"', 'g');
            let objContinuation = new RegExp('"continuationCommand":[^"]*"token":[^"]*"([^"]*)"', 'g');

            if ((strRegex = objClicktrack.exec(strResponse)) !== null) {
                strClicktrack = strRegex[1];
            }

            if ((strRegex = objContinuation.exec(strResponse)) !== null) {
                strContinuation = strRegex[1];
            }

            let objTransaction = Database.objDatabase.transaction(['storeDatabase'], 'readwrite');
            let objDatabase = objTransaction.objectStore('storeDatabase');

            for (let objVideo of funcParsevideos(strResponse, false)) {
                let objGet = await objDatabase.index('strIdent').get(objVideo['strIdent']);

                if ((objGet === undefined) || (objGet === null)) {
                    intNew += 1;

                } else if ((objGet !== undefined) && (objGet !== null)) {
                    intExisting += 1;

                }

                // the youtube watch history could be from any device - the resume bar (red line) on the thumbnail decides how
                // far it was actually watched: a full bar (>= threshold) is watched, a bar below the threshold is watching.
                // when no percentage can be read at all we no longer assume watched: we surface it as watching and warn, so a
                // parse regression (eg a new lockup ui shape) can never silently mass-flip the whole history to watched.
                let intPercent = funcPercent(objVideo['objVideo']);
                let strState = 'watched';

                if (intPercent === null) {
                    strState = 'watching';

                    console.warn('[YWM state] history sync found no resume-bar percentage - treating as watching', {
                        'strIdent': objVideo['strIdent'],
                        'strTitle': objVideo['strTitle'],
                        'strSource': 'youtube-history-sync',
                    });

                } else if (intPercent < intThreshold) {
                    strState = 'watching';

                }

                await funcRecord(objDatabase, {
                    'strIdent': objVideo['strIdent'],
                    'strTitle': objVideo['strTitle'],
                    'strState': strState,
                    'intPercent': intPercent,
                    'boolAssumed': true,
                    'strSource': 'youtube-history-sync',
                });

                funcProgress({
                    'strProgress': 'imported ' + (intNew + intExisting) + ' videos - ' + intNew + ' were new',
                });
            }

            await funcStorageset('extensions.Youwatch.Database.intSize', await objDatabase.count());
            await funcStorageset('extensions.Youwatch.Youtube.intTimestamp', new Date().getTime());

            await objTransaction.done;

            if (intExisting > objRequest.intThreshold) {
                break;

            } else if (strContinuation === null) {
                break;

            }
        }

        return {};
    },

    lookup: async function(objRequest) {
        let objTransaction = Database.objDatabase.transaction(['storeDatabase'], 'readonly');
        let objDatabase = objTransaction.objectStore('storeDatabase');

        let objGet = await objDatabase.index('strIdent').get(objRequest.strIdent);

        if ((objGet === undefined) || (objGet === null)) {
            return null;
        }

        let strState = funcStoredstate(objGet, 'youtube-lookup');

        return {
            'strIdent': objGet.strIdent,
            'intTimestamp': objGet.intTimestamp || new Date().getTime(),
            'strTitle': objGet.strTitle || '',
            'strState': strState,
            'intPercent': strState === 'watched' ? 100 : (objGet.intPercent || 0),
            'intCount': objGet.intCount || 0,
            'strDebugSource': objGet.strDebugSource || '',
            'strDebugReason': objGet.strDebugReason || '',
            'intDebugTimestamp': objGet.intDebugTimestamp || 0,
        };
    },

    forget: async function(objRequest) {
        let strIdent = objRequest.strIdent || '';

        if (strIdent.length !== 11) {
            return null;
        }

        let objTransaction = Database.objDatabase.transaction(['storeDatabase'], 'readwrite');
        let objDatabase = objTransaction.objectStore('storeDatabase');
        let objGet = await objDatabase.index('strIdent').get(strIdent);

        if ((objGet === undefined) || (objGet === null)) {
            await objTransaction.done;
            return {
                'strIdent': strIdent,
                'boolDeleted': false,
            };
        }

        await objDatabase.delete(strIdent);
        await funcStorageset('extensions.Youwatch.Database.intSize', await objDatabase.count());
        await objTransaction.done;

        if (objHistorycache !== null) {
            delete objHistorycache.objTokens[strIdent];
        }

        console.debug('[YWM forget] removed from local database', {
            'strIdent': strIdent,
            'strTitle': objGet.strTitle || '',
            'strSource': objRequest.strSource || 'unknown',
        });

        return {
            'strIdent': strIdent,
            'strTitle': objGet.strTitle || '',
            'boolDeleted': true,
        };
    },

    mark: async function(objRequest) {
        let objTransaction = Database.objDatabase.transaction(['storeDatabase'], 'readwrite');
        let objDatabase = objTransaction.objectStore('storeDatabase');

        let objGet = await objDatabase.index('strIdent').get(objRequest.strIdent);

        // boolEnsure is set by the lightweight watching signals (open / 3s playback ping) - there is nothing left to do
        // once a video is watched, with three exceptions: a live completion, a resume-bar reading, and live player
        // progress from the middle that can demote an assumed (watched elsewhere, never confirmed here) watched back to watching
        if ((objGet !== undefined) && (objGet !== null) && (objRequest.boolEnsure === true) && (funcStoredstate(objGet, 'youtube-mark') === 'watched') && (objRequest.boolCompleted !== true)) {
            let boolLivePartial = (objRequest.boolOpened === true) && (objRequest.strState !== 'watched') && ((objRequest.intPercent || 0) >= 5);

            // a confirmed/sticky mark still yields to fresh, real evidence of resuming from early in the video -
            // only skip here when there is no such evidence at all
            if ((objRequest.boolResume !== true) && (boolLivePartial !== true)) {
                funcDebugmark('watched skip', objRequest, {
                    'strReason': objGet.boolConfirmed === true ? 'existing watched mark is confirmed and sticky, and no fresh contrary evidence arrived' : 'existing watched mark already satisfies lightweight ensure signal',
                    'boolNew': false,
                    'boolStored': false,
                    'strStateold': 'watched',
                    'strStatenew': 'watched',
                    'intPercentstored': 100,
                    'intCountincrement': 0,
                    'boolOpened': objGet.boolOpened === true,
                    'boolConfirmed': objGet.boolConfirmed === true,
                });
                return null;
            }
        }

        let objWrite = await funcRecord(objDatabase, {
            'strIdent': objRequest.strIdent,
            'intTimestamp': objRequest.intTimestamp,
            'strTitle': objRequest.strTitle,
            'strState': objRequest.strState || 'watching',
            'intPercent': objRequest.intPercent,
            'boolCompleted': objRequest.boolCompleted === true,
            'boolOpened': objRequest.boolOpened === true,
            'boolResume': objRequest.boolResume === true,
            'boolAssumed': objRequest.boolAssumed === true,
            'boolConfirmed': objRequest.boolConfirmed === true,
            'boolEnsure': objRequest.boolEnsure === true,
            'boolShorts': objRequest.boolShorts === true,
            'strSource': objRequest.strSource || 'youtube-mark',
        });

        await funcStorageset('extensions.Youwatch.Database.intSize', await objDatabase.count());

        await objTransaction.done;

        return objWrite.objResult;
    }
};

let Search = {
    init: function() {
        chrome.runtime.onConnect.addListener(function(objPort) {
            if (objPort.name === 'search') {
                objPort.onMessage.addListener(async function(objData) {
                    if (objData.strMessage === 'searchLookup') {
                        objPort.postMessage({
                            'strMessage': 'searchLookup',
                            'objResponse': await Search.lookup(objData.objRequest),
                        });

                    } else if (objData.strMessage === 'searchDelete') {
                        objPort.postMessage({
                            'strMessage': 'searchDelete',
                            'objResponse': await Search.delete(objData.objRequest, function(objResponse) {
                                objPort.postMessage({
                                    'strMessage': 'searchDelete-progress',
                                    'objResponse': objResponse,
                                });
                            }),
                        });

                    }
                });
            }
        });
    },

    lookup: async function(objRequest) {
        let objVideos = [];
        let objTransaction = Database.objDatabase.transaction(['storeDatabase'], 'readonly');
        let objDatabase = objTransaction.objectStore('storeDatabase');
        let objCursor = await objDatabase.index('intTimestamp').openCursor(null, 'prev');

        while (objCursor) {
            if (objVideos.length === objRequest.intLength) {
                break;
            }

            if ((objCursor.value.strIdent.toLowerCase().indexOf(objRequest.strQuery.toLowerCase()) !== -1) || (objCursor.value.strTitle.toLowerCase().indexOf(objRequest.strQuery.toLowerCase()) !== -1)) {
                if (objRequest.intSkip!== 0) {
                    objRequest.intSkip -= 1;

                } else if (objRequest.intSkip === 0) {
                    let strState = funcStoredstate(objCursor.value, 'search-lookup');

                    objVideos.push({
                        'strIdent': objCursor.value.strIdent,
                        'intTimestamp': objCursor.value.intTimestamp,
                        'strTitle': objCursor.value.strTitle,
                        'strState': strState,
                        'intPercent': strState === 'watched' ? 100 : (objCursor.value.intPercent || 0),
                        'intCount': objCursor.value.intCount,
                    });

                }
            }

            objCursor = await objCursor.continue();
        }

        return {
            'objVideos': objVideos
        };
    },

    delete: async function(objRequest, funcProgress) {
        let intStart = Date.now();
        let funcLog = function(strLabel) {
            console.log('[YWM delete] +' + String(Date.now() - intStart).padStart(5, ' ') + 'ms  ' + strLabel);
        };

        funcLog('begin delete of ' + objRequest.strIdent);

        let objTransaction = Database.objDatabase.transaction(['storeDatabase'], 'readwrite');
        let objDatabase = objTransaction.objectStore('storeDatabase');

        // estimate how deep the video sits in the youtube history from its position in the local timeline, so we only
        // page through roughly as far as needed (plus a safety margin) - this has to happen before the record is deleted
        let intMaxFetch = 16; // fallback when the position cannot be estimated
        try {
            let objExisting = await objDatabase.get(objRequest.strIdent);

            if ((objExisting !== undefined) && (objExisting !== null) && (objExisting.intTimestamp)) {
                let intNewer = await objDatabase.index('intTimestamp').count(IDBKeyRange.lowerBound(objExisting.intTimestamp, true));
                let intPage = Math.ceil(intNewer / 20); // youtube returns roughly 20 videos per history page
                intMaxFetch = Math.min(intPage + 3, 30); // the estimated page plus a small safety margin, clamped to a sane range
                funcLog('position estimate: ' + intNewer + ' newer records -> search up to ' + intMaxFetch + ' pages');
            } else {
                funcLog('position estimate: record not found -> search up to ' + intMaxFetch + ' pages (fallback)');
            }
        } catch (objError) {
            // fall back to the default cap
            funcLog('position estimate failed -> search up to ' + intMaxFetch + ' pages (fallback)');
        }

        funcProgress({
            'strProgress': '1/5 - deleting it from the database',
        });

        await objDatabase.delete(objRequest.strIdent);

        await funcStorageset('extensions.Youwatch.Database.intSize', await objDatabase.count());

        await objTransaction.done;

        funcLog('step 1 done - removed from local database');

        funcProgress({
            'strProgress': '2/5 - deleting it from the history in the browser',
        });

        let objHistory = await chrome.history.search({
            'text': objRequest.strIdent,
            'startTime': 0,
            'maxResults': 1000000,
        });

        funcLog('step 2 - browser history search returned ' + objHistory.length + ' entries');

        for (let objEntry of objHistory) {
            if ((objEntry.url.indexOf('.youtube.com/watch?v=') === -1) && (objEntry.url.indexOf('.youtube.com/shorts/') === -1)) {
                continue;

            } else if ((objEntry.title === undefined) || (objEntry.title === null)) {
                continue;

            }

            chrome.history.deleteUrl({
                'url': objEntry.url,
            });
        }

        funcLog('step 2 done - removed matching urls from browser history');

        funcProgress({
            'strProgress': '3/5 - locating it in the history on youtube',
        });

        // reuse the cached history pages when they are still fresh, otherwise start a new cache
        if ((objHistorycache === null) || ((Date.now() - objHistorycache.intTimestamp) >= intHistorycachettl)) {
            objHistorycache = {
                'intTimestamp': Date.now(),
                'objContext': null,
                'objTokens': {},
                'strContinuation': null,
                'strClicktrack': null,
                'intPages': 0,
                'boolExhausted': false,
            };

            funcLog('history cache: starting fresh');

        } else {
            funcLog('history cache: reusing ' + objHistorycache.intPages + ' page(s) / ' + Object.keys(objHistorycache.objTokens).length + ' known videos');

        }

        let objLookup = objHistorycache.objTokens.hasOwnProperty(objRequest.strIdent) === true ? objHistorycache.objTokens[objRequest.strIdent] : null;

        if (objLookup !== null) {
            funcLog('step 3 done - served from cache, no fetch needed');
        }

        try {
            // keep paging (extending the shared cache) until the video turns up, the history runs out, or the budget is reached
            while ((objLookup === null) && (objHistorycache.boolExhausted === false) && (objHistorycache.intPages < intMaxFetch)) {
                let objFetch = null;
                let intFetchStart = Date.now();
                let strKind = '';

                if (objHistorycache.objContext === null) {
                    strKind = 'initial /feed/history html';
                    objFetch = await fetch('https://www.youtube.com/feed/history', {
                        'method': 'GET',
                        'credentials': 'include',
                    });

                } else if (objHistorycache.strContinuation !== null) {
                    strKind = 'continuation browse api';
                    objFetch = await funcYoufetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { 'continuation': objHistorycache.strContinuation }, objHistorycache.objContext, objHistorycache.strClicktrack);

                } else {
                    break; // no context yet would be page 1; otherwise no continuation means there is nothing more to fetch

                }

                let strResponse = await objFetch.text();

                funcLog('  page ' + (objHistorycache.intPages + 1) + ' (' + strKind + ') fetched in ' + (Date.now() - intFetchStart) + 'ms, ' + strResponse.length + ' chars');

                if (objHistorycache.objContext === null) {
                    objHistorycache.objContext = funcHackyparse(strResponse.split('"INNERTUBE_CONTEXT":')[1]);
                }

                let strRegex = null;
                let objClicktrack = new RegExp('"continuationEndpoint":[^"]*"clickTrackingParams":[^"]*"([^"]*)"', 'g');
                let objContinuation = new RegExp('"continuationCommand":[^"]*"token":[^"]*"([^"]*)"', 'g');

                objHistorycache.strClicktrack = (strRegex = objClicktrack.exec(strResponse)) !== null ? strRegex[1] : null;
                objHistorycache.strContinuation = (strRegex = objContinuation.exec(strResponse)) !== null ? strRegex[1] : null;
                objHistorycache.intPages += 1;

                if (objHistorycache.strContinuation === null) {
                    objHistorycache.boolExhausted = true; // youtube did not hand us a way to page further
                }

                for (let objVideo of funcParsevideos(strResponse, false)) {
                    if (objHistorycache.objTokens.hasOwnProperty(objVideo['strIdent']) === true) {
                        continue;
                    }

                    let objTokens = funcDeletetokens(objVideo['objVideo']);

                    if (objTokens !== null) {
                        objHistorycache.objTokens[objVideo['strIdent']] = objTokens;
                    }
                }

                if (objHistorycache.objTokens.hasOwnProperty(objRequest.strIdent) === true) {
                    objLookup = objHistorycache.objTokens[objRequest.strIdent];
                    funcLog('step 3 done - found on page ' + objHistorycache.intPages);
                }
            }
        } catch (objError) {
            funcLog('step 3 threw: ' + objError);
        }

        if (objLookup === null) {
            funcLog('step 3 done - NOT found (cache now holds ' + objHistorycache.intPages + ' page(s))');

            funcProgress({
                'strProgress': '4/5 - did not find it in the history on youtube',
            });

        } else if (objLookup !== null) {
            funcProgress({
                'strProgress': '4/5 - deleting it from the history on youtube',
            });

            let intFeedbackStart = Date.now();

            await funcYoufetch('https://www.youtube.com/youtubei/v1/feedback', { 'feedbackTokens': [objLookup.strFeedback], 'isFeedbackTokenUnencrypted': false, 'shouldMerge': false }, objHistorycache.objContext, objLookup.strClicktrack);

            funcLog('step 4 done - youtube feedback delete request took ' + (Date.now() - intFeedbackStart) + 'ms');

            delete objHistorycache.objTokens[objRequest.strIdent]; // it is gone from youtube now, so drop its stale token

            funcProgress({
                'strProgress': '5/5 - looks like we are all done here',
            });

        }

        funcLog('total ' + (Date.now() - intStart) + 'ms');

        return {};
    }
};

// ##########################################################

(async function() {
    // the background runs whenever the service worker is alive (including right after a browser start), so a single
    // keep-alive interval here is enough - a second one in onStartup only added a redundant timer after a restart
    setInterval(chrome.runtime.getPlatformInfo, 20000); // https://github.com/sniklaus/youtube-watchmarker/issues/179

    if (await funcStorageget('extensions.Youwatch.Database.intSize') === null) {
        await funcStorageset('extensions.Youwatch.Database.intSize', 0);
    }

    if (await funcStorageget('extensions.Youwatch.History.intTimestamp') === null) {
        await funcStorageset('extensions.Youwatch.History.intTimestamp', 0);
    }

    if (await funcStorageget('extensions.Youwatch.Youtube.intTimestamp') === null) {
        await funcStorageset('extensions.Youwatch.Youtube.intTimestamp', 0);
    }

    if (await funcStorageget('extensions.Youwatch.Condition.boolBrownav') === null) {
        await funcStorageset('extensions.Youwatch.Condition.boolBrownav', true);
    }

    await funcStorageset('extensions.Youwatch.Condition.boolBrowhist', false); // Firefox/browser history sync is paused because page visits are not reliable watch signals

    if (await funcStorageget('extensions.Youwatch.Condition.boolYouprog') === null) {
        await funcStorageset('extensions.Youwatch.Condition.boolYouprog', true);
    }

    if (await funcStorageget('extensions.Youwatch.Condition.boolYoubadge') === null) {
        await funcStorageset('extensions.Youwatch.Condition.boolYoubadge', true);
    }

    if (await funcStorageget('extensions.Youwatch.Condition.boolYouhist') === null) {
        await funcStorageset('extensions.Youwatch.Condition.boolYouhist', true);
    }

    const strThreshold = await funcStorageget('extensions.Youwatch.Condition.intThreshold');
    const intThreshold = parseInt(strThreshold);

    if ((strThreshold === null) || (isNaN(intThreshold) === true) || (intThreshold === 95)) {
        await funcStorageset('extensions.Youwatch.Condition.intThreshold', 99); // the percentage of a video that has to be reached before it counts as watched
    }

    if (await funcStorageget('extensions.Youwatch.Visualization.boolFadeout') === null) {
        await funcStorageset('extensions.Youwatch.Visualization.boolFadeout', true);
    }

    if (await funcStorageget('extensions.Youwatch.Visualization.boolGrayout') === null) {
        await funcStorageset('extensions.Youwatch.Visualization.boolGrayout', true);
    }

    if (await funcStorageget('extensions.Youwatch.Visualization.boolShowbadge') === null) {
        await funcStorageset('extensions.Youwatch.Visualization.boolShowbadge', true);
    }

    if (await funcStorageget('extensions.Youwatch.Visualization.boolShowwatching') === null) {
        await funcStorageset('extensions.Youwatch.Visualization.boolShowwatching', true);
    }

    if (await funcStorageget('extensions.Youwatch.Visualization.boolShowdate') === null) {
        await funcStorageset('extensions.Youwatch.Visualization.boolShowdate', false);
    }

    if (await funcStorageget('extensions.Youwatch.Visualization.boolShowcount') === null) {
        await funcStorageset('extensions.Youwatch.Visualization.boolShowcount', true);
    }

    if (await funcStorageget('extensions.Youwatch.Visualization.strTheme') === null) {
        await funcStorageset('extensions.Youwatch.Visualization.strTheme', 'bw');
    }

    await funcApplytheme(await funcStorageget('extensions.Youwatch.Visualization.strTheme'));

    if ((await funcStorageget('extensions.Youwatch.Stylesheet.strShowdate') === null) || ((await funcStorageget('extensions.Youwatch.Stylesheet.strShowdate')).indexOf('do not modify') === -1)) {
        await funcStorageset('extensions.Youwatch.Stylesheet.strShowdate', '.youwatch-watched > .youwatch-thumbnail-label > .youwatch-thumbnail-state::after { content:attr(watchdate); white-space:nowrap; }');
    }

    await Database.init();
    await History.init();
    await Youtube.init();
    await Search.init();

    chrome.action.onClicked.addListener(function() {
        chrome.runtime.openOptionsPage();
    });

    chrome.runtime.onMessage.addListener(function(objRequest, objSender, funcResponse) {
        // every youtube* message that carries a title feeds the shared title cache
        if ((typeof objRequest.strIdent === 'string') && (typeof objRequest.strTitle === 'string') && (objRequest.strTitle !== '')) {
            Youtube.strTitlecache[objRequest.strIdent] = objRequest.strTitle;
        }

        if (objRequest.strMessage === 'themeApply') {
            funcApplytheme(objRequest.strTheme).then(function() {
                funcResponse(true);
            });

            return true; // indicate async response

        } else if (objRequest.strMessage === 'youtubeLookup') {
            Youtube.lookup({
                'strIdent': objRequest.strIdent,
                'strTitle': objRequest.strTitle,
            }).then(funcResponse);

            return true; // indicate async response, i also tried using an async function with await but could not make it work

        } else if (objRequest.strMessage === 'youtubeMark') {
            Youtube.mark({
                'strIdent': objRequest.strIdent,
                'intTimestamp': objRequest.intTimestamp || undefined, // the date youtube lists it under, when supplied from the history page
                'strTitle': objRequest.strTitle,
                'strState': objRequest.strState,
                'intPercent': objRequest.intPercent,
                'boolAssumed': objRequest.boolAssumed === true, // a watched coming from the youtube history page
                'boolConfirmed': objRequest.boolConfirmed === true, // an explicit "mark as watched" that should stick
                'boolEnsure': objRequest.boolEnsure,
                'strSource': objRequest.strSource || (objRequest.boolConfirmed === true ? 'manual-mark' : (objRequest.boolAssumed === true ? 'youtube-history-page' : 'youtube-mark-message')),
            }).then(function(objResult) {
                funcNotifywatchlist(objResult); // the history-page resume-bar scan can promote/demote a watchlisted video too
                funcResponse(objResult);
            });

            return true; // indicate async response, i also tried using an async function with await but could not make it work

        } else if (objRequest.strMessage === 'youtubeForget') {
            Youtube.forget({
                'strIdent': objRequest.strIdent,
                'strSource': objRequest.strSource || 'youtube-forget-message',
            }).then(function(objResult) {
                funcBroadcastforget(objResult);
                funcNotifywatchlist(objResult);
                funcResponse(objResult);
            });

            return true; // indicate async response

        } else if (objRequest.strMessage === 'youtubeComplete') {
            // the player reported >= the threshold on the active video - this confirms a completed watch in this browser
            Youtube.mark({
                'strIdent': objRequest.strIdent,
                'intTimestamp': new Date().getTime(),
                'strTitle': objRequest.strTitle,
                'strState': 'watched',
                'boolCompleted': true,
                'boolOpened': true,
                'strSource': 'player-threshold-complete',
            }).then(function(objResult) {
                funcBroadcast(objResult);

                if ((objResult !== null) && (objResult !== undefined) && (objResult.strState === 'watched')) {
                    let objWatchlist = {
                        'strMessage': 'watchlist:completed',
                        'strIdent': objResult.strIdent,
                        'strTitle': objResult.strTitle,
                        'intTimestamp': objResult.intTimestamp,
                        'intPercent': 100,
                    };

                    if (typeof globalThis.funcWatchlistCompleted === 'function') {
                        globalThis.funcWatchlistCompleted(objWatchlist);
                    }

                    chrome.runtime.sendMessage(objWatchlist, function() {
                        void chrome.runtime.lastError;
                    });
                }

                funcResponse(objResult);
            });

            return true; // indicate async response, i also tried using an async function with await but could not make it work

        } else if (objRequest.strMessage === 'youtubeWatching') {
            // the active player is below the threshold - record live progress (and a resume from the middle can demote an assumed watched)
            Youtube.mark({
                'strIdent': objRequest.strIdent,
                'intTimestamp': new Date().getTime(),
                'strTitle': objRequest.strTitle,
                'strState': 'watching',
                'intPercent': objRequest.intPercent,
                'boolOpened': true,
                'boolResume': objRequest.boolResume === true,
                'boolEnsure': true,
                'boolShorts': objRequest.boolShorts === true,
                'strSource': 'player-progress',
            }).then(function(objResult) {
                funcBroadcast(objResult);
                funcNotifywatchlist(objResult);

                funcResponse(objResult);
            });

            return true; // indicate async response, i also tried using an async function with await but could not make it work

        } else if (objRequest.strMessage === 'youtubeProgress') {
            // a feed/history thumbnail with a resume progress bar - the percentage decides watching vs watched, and a
            // partial bar (treated as a resume reading) can demote an assumed (watched elsewhere, not confirmed) watched
            funcStorageget('extensions.Youwatch.Condition.intThreshold')
                .then(function(strThreshold) {
                    let intThreshold = parseInt(strThreshold) || 99;
                    let strState = ((objRequest.intPercent !== undefined) && (objRequest.intPercent !== null) && (objRequest.intPercent >= intThreshold)) ? 'watched' : 'watching';

                    funcStorageget('extensions.Youwatch.Condition.boolYoubadge')
                        .then(function(strValue) {
                            if (strValue !== String(true)) {
                                funcResponse(null); // badge disabled - still close the message channel so it does not leak
                                return;
                            }

                            Youtube.mark({
                                'strIdent': objRequest.strIdent,
                                'strTitle': objRequest.strTitle,
                                'strState': strState,
                                'intPercent': objRequest.intPercent,
                                'boolResume': strState === 'watching',
                                'boolEnsure': objRequest.boolEnsure,
                                'strSource': 'thumbnail-progress',
                            }).then(function(objResult) {
                                funcBroadcast(objResult);
                                funcNotifywatchlist(objResult);

                                funcResponse(objResult);
                            });
                        })
                    ;
                })
            ;

            return true; // indicate async response, i also tried using an async function with await but could not make it work

        }
    });

    chrome.tabs.onUpdated.addListener(async function(intTab, objChange, objTab) {
        if (objTab.id < 0) {
            return;

        } else if (objTab.url.indexOf('.youtube.com') === -1) {
            return;

        }

        if ((objChange.title !== undefined) && (objChange.title !== null)) {
            await funcMarktabopen(objTab, objChange.title);
        }

        // only (re)inject the mark stylesheets once the document has finished loading. onUpdated fires several times per
        // navigation (url, title, favicon, ...); injecting on each one piled duplicate copies of every stylesheet into
        // the tab. a full document load clears the previously injected css, and spa navigations reuse the same document,
        // so the single injection at "complete" is all that is needed.
        if (objChange.status !== 'complete') {
            return;
        }

        await funcMarktabopen(objTab);

        // each stylesheet is gated by its visualization flag (the date badge additionally needs the badge itself);
        // one batched storage read replaces the previous per-stylesheet round-trips
        let objStylesheets = [
            { 'strFlag': 'boolFadeout', 'strSheet': 'strFadeout' },
            { 'strFlag': 'boolGrayout', 'strSheet': 'strGrayout' },
            { 'strFlag': 'boolShowbadge', 'strSheet': 'strShowbadge' },
            { 'strFlag': 'boolShowwatching', 'strSheet': 'strShowwatching' },
            { 'strFlag': 'boolShowdate', 'strSheet': 'strShowdate', 'strRequires': 'boolShowbadge' },
            { 'strFlag': 'boolShowcount', 'strSheet': 'strShowcount' },
            { 'strSheet': 'strShowactive', 'boolAlways': true }, // the active player label is a real element, so it is styled whenever it is shown
        ];

        let objSettings = await chrome.storage.local.get(objStylesheets.flatMap(function(objEntry) {
            return (objEntry.boolAlways === true) ? ['extensions.Youwatch.Stylesheet.' + objEntry.strSheet] : ['extensions.Youwatch.Visualization.' + objEntry.strFlag, 'extensions.Youwatch.Stylesheet.' + objEntry.strSheet];
        }));

        for (let objEntry of objStylesheets) {
            let boolEnabled = (objEntry.boolAlways === true) || (String(objSettings['extensions.Youwatch.Visualization.' + objEntry.strFlag]) === String(true));
            let boolRequired = (objEntry.strRequires === undefined) || (String(objSettings['extensions.Youwatch.Visualization.' + objEntry.strRequires]) === String(true));

            if ((boolEnabled === true) && (boolRequired === true)) {
                chrome.scripting.insertCSS({
                    target: { tabId: objTab.id },
                    css: objSettings['extensions.Youwatch.Stylesheet.' + objEntry.strSheet],
                });
            }
        }
    });

    chrome.webRequest.onBeforeRequest.addListener(async function(objData) { // does not seem to get triggered in firefox so we need to revisit this at some point
        if (await funcStorageget('extensions.Youwatch.Condition.boolYouprog') === String(true)) {
            if (objData.url.indexOf('muted=1') !== -1) {
                return;
            }

            // not every watchtime request carries et= / docid= - reading them defensively avoids throwing on the ones that don't
            let objParams = null;

            try {
                objParams = new URL(objData.url).searchParams;
            } catch (objError) {
                return;
            }

            let strElapsedlist = objParams.get('et');
            let strIdent = objParams.get('docid') || '';

            if ((strElapsedlist === null) || (strIdent.length !== 11)) {
                return;
            }

            for (let strElapsed of strElapsedlist.split(',')) {
                if (parseFloat(strElapsed) < 3.0) {
                    continue;
                }

                let strTitle = Youtube.strTitlecache.hasOwnProperty(strIdent) === true ? Youtube.strTitlecache[strIdent] : '';

                if (strTitle === '') {
                    continue;

                }

                // the player reporting a few seconds of playback means it was opened here - the threshold is detected separately
                let objResult = await Youtube.mark({
                    'strIdent': strIdent,
                    'strTitle': strTitle,
                    'strState': 'watching',
                    'boolOpened': true,
                    'boolEnsure': true,
                    'strSource': 'watchtime-ping',
                });

                funcBroadcast(objResult);
                funcNotifywatchlist(objResult);
            }
        }
    }, {
        urls: ['https://www.youtube.com/api/stats/watchtime*']
    });

    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1],
        addRules: [{
            id: 1,
            action: {
                type: 'modifyHeaders',
                requestHeaders: [{
                    header: 'Origin',
                    operation: 'set',
                    value: 'https://www.youtube.com',
                }, {
                    header: 'Referer',
                    operation: 'set',
                    value: 'https://www.youtube.com/feed/history',
                }, {
                    header: 'Sec-Fetch-Mode',
                    operation: 'set',
                    value: 'same-origin',
                }]
            },
            condition: {
                urlFilter: '|https://www.youtube.com/youtubei/v1/*',
                resourceTypes: ['xmlhttprequest'],
            },
        }],
    });

    chrome.alarms.create('synchronize', {
        'periodInMinutes': 60,
    });

    chrome.alarms.onAlarm.addListener(async function(objAlarm) {
        if (objAlarm.name === 'synchronize') {
            if (await funcStorageget('extensions.Youwatch.Condition.boolBrowhist') === String(true)) {
                await History.synchronize({
                    'intTimestamp': new Date().getTime() - (7 * 24 * 60 * 60 * 1000),
                }, function(objResponse) {
                    // ...
                });

                console.debug('synchronized history');
            }

            if (await funcStorageget('extensions.Youwatch.Condition.boolYouhist') === String(true)) {
                await Youtube.synchronize({
                    'intThreshold': 512,
                }, function(objResponse) {
                    // ...
                });

                console.debug('synchronized youtube');
            }
        }
    });
})();
