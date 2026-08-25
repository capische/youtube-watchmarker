'use strict';

let boolDirty = true; // set by the mutation observer whenever the dom changes (new thumbnails, spa navigation) so the polling loop knows a rescan is worthwhile
let strLastnav = null; // the href + title the polling loop last acted on, to catch navigations that do not mutate the dom
let objVideodata = {}; // strIdent -> { intTimestamp, strState, intPercent, intCount }
let objCompleted = {}; // strIdent -> true once the active player has crossed the threshold in this session
let objReported = {}; // strIdent -> last whole percent we reported to the background while watching
let objReporttime = {}; // strIdent -> last timestamp we reported while the player was active
let strProgressnav = null; // active page/video key whose completion and progress guards the maps above belong to
let objDebugmarked = {}; // de-duplicates watched badge debug output for the same stored decision
let objDebughistory = {}; // de-duplicates missing history progress diagnostics
let objHistoryharvested = new WeakSet(); // history thumbnails whose resume bar has already been read once - a bar is only
// fresh when its element first renders (page load / scrolled in); later rescans of the same element (tab re-activation,
// dom mutations) would re-read a stale bar and could wrongly re-mark or demote, so those become plain lookups instead
let strHistorymenuident = null; // video id for the history row whose youtube menu was last opened
let intHistorymenutime = 0;
let objHistoryremoved = {}; // de-duplicates native youtube history removal messages
let objActivelookups = {}; // strIdent -> true while the active player state lookup is in flight
let objActivelabelmisses = {}; // strIdent -> true after an active player lookup found no stored state
let objActivelabel = null;
let intActivelabelwait = null; // retry timer while the theme stylesheet has not reached the tab yet
let intThreshold = 99; // the percentage of a video that counts as watched, kept in sync with the settings
let boolYouhist = true; // whether videos shown on the youtube history page should be marked as watched
let objObservers = new WeakMap();
let objHovers = new WeakSet();

chrome.storage.local.get(['extensions.Youwatch.Condition.intThreshold', 'extensions.Youwatch.Condition.boolYouhist'], function(objValue) {
    intThreshold = parseInt(objValue['extensions.Youwatch.Condition.intThreshold']) || 99;
    boolYouhist = objValue['extensions.Youwatch.Condition.boolYouhist'] !== String(false);
});

chrome.storage.onChanged.addListener(function(objChanges, strArea) {
    if (strArea !== 'local') {
        return;
    }

    if (objChanges.hasOwnProperty('extensions.Youwatch.Condition.intThreshold') === true) {
        intThreshold = parseInt(objChanges['extensions.Youwatch.Condition.intThreshold'].newValue) || 99;
    }

    if (objChanges.hasOwnProperty('extensions.Youwatch.Condition.boolYouhist') === true) {
        boolYouhist = objChanges['extensions.Youwatch.Condition.boolYouhist'].newValue !== String(false);
    }
});

// ##########################################################

let objVideoselectors = [ // %IDENT% is replaced with a video id, or with nothing to match every video
    'a.ytLockupViewModelContentImage[href^="/watch?v=%IDENT%"]', // new - https://github.com/sniklaus/youtube-watchmarker/issues/195
    'a.yt-lockup-view-model__content-image[href^="/watch?v=%IDENT%"]', // old
    'a.ytd-thumbnail[href^="/watch?v=%IDENT%"]', // list
    'a.reel-item-endpoint[href^="/shorts/%IDENT%"]', // shorts
    'a.shortsLockupViewModelHostEndpoint[href*="/shorts/%IDENT%"]', // shorts lockup
    'a.ytLockupViewModelContentImage[href^="/shorts/%IDENT%"]', // shorts in lockup
    'a.yt-lockup-view-model__content-image[href^="/shorts/%IDENT%"]', // shorts in lockup
    'a.ytd-thumbnail[href^="/shorts/%IDENT%"]', // shorts in list
    'a.ytp-modern-videowall-still[href*="/watch?v=%IDENT%"]', // videowall
    'a.ytp-videowall-still[href*="/watch?v=%IDENT%"]', // videowall
    'a.ytp-ce-covering-overlay[href*="/watch?v=%IDENT%"]', // overlays
    'a.media-item-thumbnail-container[href*="/watch?v=%IDENT%"]', // mobile
    'a.YtmCompactMediaItemImage[href*="/watch?v=%IDENT%"]', // mobile
].join(', ');

let strVideoselectorall = objVideoselectors.split('%IDENT%').join(''); // the match-every-video form runs on each rescan tick, so build it once

let videos = function(strIdent) {
    return Array.from(window.document.querySelectorAll(strIdent === '' ? strVideoselectorall : objVideoselectors.split('%IDENT%').join(strIdent)));
};

let funcIdent = function(objVideo) { // the 11 character id sits after /shorts/ for shorts and at the end of the watch url otherwise
    if (objVideo.href.indexOf('/shorts/') !== -1) {
        return objVideo.href.split('/shorts/')[1].slice(0, 11);
    }

    return objVideo.href.split('&')[0].slice(-11);
};

let funcElementident = function(objElement) {
    let objCard = objElement.closest('ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, yt-lockup-view-model, .yt-lockup-view-model, .ytLockupViewModelHost');

    if (objCard === null) {
        return null;
    }

    let objLink = objCard.querySelector([
        'a[href^="/watch?v="]',
        'a[href*="/watch?v="]',
        'a[href^="/shorts/"]',
        'a[href*="/shorts/"]',
    ].join(', '));

    if ((objLink === null) || ((objLink.href || '') === '')) {
        return null;
    }

    return funcIdent(objLink);
};

// turns a youtube history section header ("Today", "Yesterday", "Jun 21, 2025", "Saturday, June 21", ...) into a timestamp;
// the watch history only exposes a per-day date, so this resolves to that day (good enough to match what youtube shows)
let funcHistorydate = function(strText) {
    strText = (strText || '').trim();

    if (strText === '') {
        return null;
    }

    let objNow = new Date();
    let strLower = strText.toLowerCase();

    if (strLower === 'today') {
        return objNow.getTime();

    } else if (strLower === 'yesterday') {
        return objNow.getTime() - 86400000;

    }

    let intParsed = Date.parse(strText); // handles absolute dates such as "Jun 21, 2025"

    if (isNaN(intParsed) === true) {
        intParsed = Date.parse(strText + ', ' + objNow.getFullYear()); // headers without a year (current year) eg "Saturday, June 21"

        if ((isNaN(intParsed) === false) && (intParsed > objNow.getTime())) {
            intParsed = Date.parse(strText + ', ' + (objNow.getFullYear() - 1)); // that day has not happened yet this year, so it was last year
        }
    }

    return isNaN(intParsed) === true ? null : intParsed;
};

// reads the date of the history section a given video sits in, if it can be located in the dom
let funcHistorytimestamp = function(objVideo) {
    let objSection = objVideo.closest('ytd-item-section-renderer');

    if (objSection === null) {
        return null;
    }

    let objTitle = objSection.querySelector('#title');

    if (objTitle === null) {
        return null;
    }

    return funcHistorydate(objTitle.innerText || objTitle.textContent || '');
};

let funcProgresspercent = function(objVideo) {
    let objCard = objVideo.closest('ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, yt-lockup-view-model, .yt-lockup-view-model, .ytLockupViewModelHost');
    let objScope = objCard || objVideo.closest('ytd-thumbnail') || objVideo;
    let objProgress = Array.from(objScope.querySelectorAll([
        'ytd-thumbnail-overlay-resume-playback-renderer #progress',
        'ytd-thumbnail-overlay-resume-playback-renderer [style*="width"]',
        'yt-thumbnail-overlay-progress-bar-view-model #progress',
        'yt-thumbnail-overlay-progress-bar-view-model [style*="width"]',
        '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
        '[class*="ThumbnailOverlayProgressBar"][style*="width"]',
        '[class*="thumbnailOverlayProgressBar"][style*="width"]',
    ].join(', ')));
    let intPercent = null;

    for (let objElement of objProgress) {
        let strStyle = objElement.getAttribute('style') || '';
        let objMatch = strStyle.match(/width\s*:\s*([0-9.]+)%/i);

        if (objMatch === null) {
            objMatch = strStyle.match(/--[^:]*percent[^:]*:\s*([0-9.]+)/i);
        }

        if (objMatch === null) {
            continue;
        }

        let intValue = Math.round(parseFloat(objMatch[1]));

        if ((isNaN(intValue) === true) || (intValue <= 0) || (intValue > 100)) {
            continue;
        }

        intPercent = (intPercent === null) ? intValue : Math.min(intPercent, intValue);
    }

    return intPercent;
};

let refresh = async function() {
    let objVideos = videos('');

    // the watch-history feed renders inside a browse element that only carries page-subtype="history" once the history
    // content has actually loaded - relying on this (instead of the url alone) avoids a window during navigation where the
    // url is already /feed/history but the previous page's thumbnails (eg the homepage) are still in the dom and would
    // otherwise get marked as watched. each video is additionally checked to actually sit inside that container.
    let objHistory = (window.location.pathname === '/feed/history') ? window.document.querySelector('ytd-browse[page-subtype="history"], [page-subtype="history"]') : null;

    for (let objVideo of objVideos) {
        let strIdent = funcIdent(objVideo);
        let strTitle = '';

        let boolHistory = (objHistory !== null) && (boolYouhist === true) && (objHistory.contains(objVideo) === true);
        let intPercent = ((boolHistory === true) && (objHistoryharvested.has(objVideo) !== true)) ? funcProgresspercent(objVideo) : null;
        let boolHistorymark = (boolHistory === true) && (intPercent !== null);

        if (boolHistorymark === true) {
            objHistoryharvested.add(objVideo); // only once a bar was actually read - thumbnails whose overlay has not
        } // rendered yet stay eligible, so the usual few-rescans-after-load retry behaviour is kept

        mark(objVideo, strIdent);

        observe(objVideo);

        hoverify(objVideo);

        // watched videos normally stay cached, but a partial history resume bar is fresh evidence that can demote
        // an unconfirmed watched mark back to watching.
        if ((objVideodata.hasOwnProperty(strIdent) === true) && (objVideodata[strIdent].strState === 'watched') && ((boolHistorymark !== true) || (intPercent >= intThreshold))) {
            continue;
        }

        for (let intTitle = 0, objTitle = objVideo.parentNode; intTitle < 5; intTitle += 1, objTitle = objTitle.parentNode) {
            if (objTitle.querySelector('.ytLockupMetadataViewModelTitle') !== null) { // new
                strTitle = objTitle.querySelector('.ytLockupMetadataViewModelTitle').innerText.trim(); break;

            } else if (objTitle.querySelector('.shortsLockupViewModelHostMetadataTitle') !== null) { // shorts
                strTitle = objTitle.querySelector('.shortsLockupViewModelHostMetadataTitle').innerText.trim(); break;

            } else if (objTitle.querySelector('#video-title') !== null) { // old
                strTitle = objTitle.querySelector('#video-title').innerText.trim(); break;

            }
        }

        if ((strTitle === '') && ((objVideo.getAttribute('aria-label') || '') !== '')) {
            strTitle = objVideo.getAttribute('aria-label').trim(); // shorts thumbnails often only expose the title via aria-label
        }

        if ((boolHistory === true) && (boolHistorymark !== true) && (objDebughistory[strIdent] !== true)) {
            objDebughistory[strIdent] = true;

            console.debug('[YWM mark] history progress missing', {
                'strIdent': strIdent,
                'strTitle': strTitle,
                'strReason': 'history thumbnail had no positive resume bar, so it was not marked watched',
                'intPercent': intPercent,
                'strUrl': objVideo.href || '',
            });
        }

        // on the youtube history page we register the video (assumed - watched elsewhere) instead of just looking it up;
        // a positive resume bar (red line) decides watching vs watched. a plain lookup only needs the id and title, so
        // the mark-only fields (state / percent / assumed / timestamp) are added only when we are actually marking.
        let objMessage = {
            'strMessage': boolHistorymark === true ? 'youtubeMark' : 'youtubeLookup',
            'strIdent': strIdent,
            'strTitle': strTitle,
        };

        if (boolHistorymark === true) {
            objMessage.strState = (intPercent >= intThreshold) ? 'watched' : 'watching';
            objMessage.intPercent = intPercent;
            objMessage.boolAssumed = true;
            // stamp it with the date youtube lists it under, so the plugin entry matches the watch history instead of "now"
            objMessage.intTimestamp = funcHistorytimestamp(objVideo);
        }

        await chrome.runtime.sendMessage(objMessage, function(objResponse) {
            if ((objResponse === null) || (objResponse === undefined)) {
                return;
            }

            objVideodata[objResponse.strIdent] = {
                'intTimestamp': objResponse.intTimestamp,
                'strState': objResponse.strState || 'watching',
                'intPercent': objResponse.intPercent || 0,
                'intCount': objResponse.intCount || 0,
                'strDebugSource': objResponse.strDebugSource || '',
                'strDebugReason': objResponse.strDebugReason || '',
                'intDebugTimestamp': objResponse.intDebugTimestamp || 0,
            };

            for (let objVideo of videos(objResponse.strIdent)) {
                mark(objVideo, objResponse.strIdent);
            }
        });
    }

    funcActivelabelsync();
};

let funcUnmark = function(objVideo) {
    if (objVideo.classList.contains('youwatch-mark') === true) {
        objVideo.classList.remove('youwatch-mark');
        objVideo.classList.remove('youwatch-watched');
        objVideo.classList.remove('youwatch-watching');

        if (objVideo.hasAttribute('watchdate') === true) {
            objVideo.removeAttribute('watchdate');
        }

        if (objVideo.hasAttribute('watchcount') === true) {
            objVideo.removeAttribute('watchcount');
        }

        if (objVideo.hasAttribute('watchpercent') === true) {
            objVideo.removeAttribute('watchpercent');
        }

        objVideo.style.removeProperty('--youwatch-percent');

        let objLabel = objVideo.querySelector('.youwatch-thumbnail-label');

        if (objLabel !== null) {
            objLabel.parentNode.removeChild(objLabel);
        }
    }
};

let funcThumbnaillabel = function(objVideo, objData) {
    let objLabel = objVideo.querySelector('.youwatch-thumbnail-label');

    if (objLabel === null) {
        objLabel = window.document.createElement('div');
        objLabel.className = 'youwatch-thumbnail-label';
        objLabel.setAttribute('aria-hidden', 'true');
        objLabel.style.display = 'none'; // the enabled WATCHED / WATCHING stylesheet reveals it once injected
        objLabel.style.left = '8px';
        objLabel.style.pointerEvents = 'none';
        objLabel.style.position = 'absolute';
        objLabel.style.top = '8px';
        objLabel.style.zIndex = '3';

        let objIcon = objLabel.appendChild(window.document.createElement('span'));
        objIcon.className = 'youwatch-thumbnail-icon';
        objIcon.textContent = '\u27f3';
        objIcon.style.display = 'none';
        objIcon.style.fontSize = '1.25em';
        objIcon.style.lineHeight = '1';
        objIcon.style.marginRight = '1px';
        objIcon.style.transform = 'translateY(-1px)';

        let objCount = objLabel.appendChild(window.document.createElement('span'));
        objCount.className = 'youwatch-thumbnail-count';
        objCount.style.display = 'none';

        let objSeparator = objLabel.appendChild(window.document.createElement('span'));
        objSeparator.className = 'youwatch-thumbnail-separator';
        objSeparator.textContent = '\u00b7';
        objSeparator.style.display = 'none';
        objSeparator.style.margin = '0 3px';

        objLabel.appendChild(window.document.createElement('span')).className = 'youwatch-thumbnail-state';
        objVideo.appendChild(objLabel);
    }

    let boolWatched = objData.strState === 'watched';
    let intCount = Math.max(0, parseInt(objData.intCount) || 0);
    let intPercent = Math.max(0, Math.min(100, objData.intPercent || 0));
    let objState = objLabel.querySelector('.youwatch-thumbnail-state');

    objLabel.querySelector('.youwatch-thumbnail-count').textContent = intCount;
    objState.textContent = boolWatched === true ? 'WATCHED' : ('WATCHING' + (intPercent > 0 ? (' ' + intPercent + '%') : ''));
    objState.setAttribute('watchdate', objVideo.getAttribute('watchdate') || '');
};

let forget = function(strIdent) {
    if (objVideodata.hasOwnProperty(strIdent) === true) {
        delete objVideodata[strIdent];
    }

    for (let strKey of Object.keys(objDebugmarked)) {
        if (strKey.indexOf(strIdent + ':') === 0) {
            delete objDebugmarked[strKey];
        }
    }

    for (let objVideo of videos(strIdent)) {
        funcUnmark(objVideo);
    }
};

let mark = function(objVideo, strIdent) {
    if (objVideodata.hasOwnProperty(strIdent) === true) {
        // a shorts video can match two elements (a thumbnail link and a separate title link) - only the one that
        // actually carries the thumbnail image gets marked, so the badge does not end up duplicated over the title
        if (objVideo.querySelector('img, .ytp-videowall-still-image') === null) {
            for (let objSibling of videos(strIdent)) {
                if ((objSibling !== objVideo) && (objSibling.querySelector('img, .ytp-videowall-still-image') !== null)) {
                    funcUnmark(objVideo);
                    return;
                }
            }
        }

        let objData = objVideodata[strIdent];
        let boolWatched = objData.strState === 'watched';

        if (boolWatched === true) {
            let strDebugkey = strIdent + ':' + (objData.intDebugTimestamp || 0) + ':' + (objData.strDebugSource || '') + ':' + (objData.strDebugReason || '');

            if (objDebugmarked[strDebugkey] !== true) {
                objDebugmarked[strDebugkey] = true;

                console.debug('[YWM mark] watched badge', {
                    'strIdent': strIdent,
                    'strSource': objData.strDebugSource || 'stored-lookup',
                    'strReason': objData.strDebugReason || 'stored state is watched',
                    'intDebugTimestamp': objData.intDebugTimestamp || 0,
                    'intTimestamp': objData.intTimestamp || 0,
                    'intPercent': objData.intPercent || 0,
                    'intCount': objData.intCount || 0,
                    'strUrl': objVideo.href || '',
                });
            }
        }

        objVideo.classList.add('youwatch-mark');
        objVideo.classList.toggle('youwatch-watched', boolWatched);
        objVideo.classList.toggle('youwatch-watching', boolWatched === false);

        if ((objData.intTimestamp !== undefined) && (objData.intTimestamp !== null) && (objData.intTimestamp !== 0)) {
            objVideo.setAttribute('watchdate', ' - ' + new Date(objData.intTimestamp).toISOString().split('T')[0].split('-').join('.'));
        }

        objVideo.setAttribute('watchcount', Math.max(0, parseInt(objData.intCount) || 0));

        if ((boolWatched === false) && (objData.intPercent > 0)) {
            objVideo.setAttribute('watchpercent', objData.intPercent); // drives the "WATCHING NN%" badge for in-progress videos
            objVideo.style.setProperty('--youwatch-percent', objData.intPercent + '%'); // drives the width of the progress bar
        } else {
            if (objVideo.hasAttribute('watchpercent') === true) {
                objVideo.removeAttribute('watchpercent');
            }

            objVideo.style.removeProperty('--youwatch-percent');
        }

        funcThumbnaillabel(objVideo, objData);

    } else {
        funcUnmark(objVideo);
    }
};

let observe = function(objVideo) {
    if (objObservers.has(objVideo) === true) {
        return;
    }

    let objObserver = new MutationObserver(function() {
        mark(objVideo, funcIdent(objVideo));
    });

    objObserver.observe(objVideo, { 'attributes': true, 'attributeFilter': ['href'] });

    objObservers.set(objVideo, objObserver);
};

// hovering over the thumbnail alone only covers a small area, so the fadeout/grayout is also lifted while hovering
// over the wider card (thumbnail + title) that triggers Youtube's own preview-on-hover behaviour
let hoverify = function(objVideo) {
    if (objHovers.has(objVideo) === true) {
        return;
    }

    objHovers.add(objVideo);

    let objCard = null;

    for (let intLevel = 0, objAncestor = objVideo.parentNode; intLevel < 5; intLevel += 1, objAncestor = objAncestor.parentNode) {
        if ((objAncestor === null) || (objAncestor === undefined) || (objAncestor === window.document.body)) {
            break;
        }

        if ((objAncestor.querySelector('.ytLockupMetadataViewModelTitle') !== null) ||
            (objAncestor.querySelector('.shortsLockupViewModelHostMetadataTitle') !== null) ||
            (objAncestor.querySelector('#video-title') !== null)) {
            objCard = objAncestor; break;

        }
    }

    if (objCard === null) {
        return; // no wider card found, the thumbnail's own :hover already covers this case
    }

    objCard.addEventListener('mouseenter', function() {
        objVideo.classList.add('youwatch-hover');
    });

    objCard.addEventListener('mouseleave', function() {
        objVideo.classList.remove('youwatch-hover');
    });
};

// ##########################################################

document.addEventListener('youtubeProgress', async function(objEvent) {
    await chrome.runtime.sendMessage({
        'strMessage': 'youtubeProgress',
        'strIdent': objEvent.detail['strIdent'],
        'strTitle': objEvent.detail['strTitle'],
        'intPercent': objEvent.detail['intPercent'],
        'boolEnsure': true,
    }, function(objResponse) {
        // ...
    });

});

// ##########################################################

document.addEventListener('click', function(objEvent) {
    if (window.location.pathname !== '/feed/history') {
        return;
    }

    let objTarget = objEvent.target;
    let strIdent = funcElementident(objTarget);

    if (strIdent !== null) {
        strHistorymenuident = strIdent;
        intHistorymenutime = Date.now();
    }

    let objMenuitem = objTarget.closest('ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, tp-yt-paper-item, yt-list-item-view-model, [role="menuitem"]');
    let strText = ((objMenuitem || objTarget).innerText || (objMenuitem || objTarget).textContent || '').toLowerCase();

    if (strText.indexOf('remove from watch history') === -1) {
        return;
    }

    if ((strHistorymenuident === null) || ((Date.now() - intHistorymenutime) > 30000) || (objHistoryremoved[strHistorymenuident] === true)) {
        return;
    }

    objHistoryremoved[strHistorymenuident] = true;

    console.debug('[YWM forget] youtube history menu removal detected', {
        'strIdent': strHistorymenuident,
    });

    chrome.runtime.sendMessage({
        'strMessage': 'youtubeForget',
        'strIdent': strHistorymenuident,
        'strSource': 'youtube-history-native-remove',
    }, function() {
        void chrome.runtime.lastError;
    });
}, true);

// ##########################################################

document.addEventListener('play', function(objEvent) {
    if ((objEvent.target === null) || (objEvent.target.tagName !== 'VIDEO')) {
        return;
    }

    funcActivelabelhide();
}, true);

document.addEventListener('pause', function(objEvent) {
    if ((objEvent.target === null) || (objEvent.target.tagName !== 'VIDEO')) {
        return;
    }

    funcActivelabelsync();
}, true);

// ##########################################################

chrome.runtime.onMessage.addListener(async function(objData, objSender, funcResponse) {
    if (objData.strMessage === 'youtubeRefresh') {
        await refresh();

    } else if (objData.strMessage === 'youtubeForget') {
        forget(objData.strIdent);
        objActivelabelmisses[objData.strIdent] = true;
        funcActivelabelsync();

    } else if (objData.strMessage === 'youtubeMark') {
        let objPrev = objVideodata.hasOwnProperty(objData.strIdent) === true ? objVideodata[objData.strIdent] : {};
        delete objActivelabelmisses[objData.strIdent];

        objVideodata[objData.strIdent] = {
            'intTimestamp': objData.intTimestamp || objPrev.intTimestamp || 0,
            'strState': objData.strState || objPrev.strState || 'watching',
            'intPercent': (objData.intPercent !== undefined) && (objData.intPercent !== null) ? objData.intPercent : (objPrev.intPercent || 0),
            'intCount': (objData.intCount !== undefined) && (objData.intCount !== null) ? objData.intCount : (objPrev.intCount || 0),
        };

        for (let objVideo of videos(objData.strIdent)) {
            mark(objVideo, objData.strIdent);
            hoverify(objVideo);
        }

        funcActivelabelsync();

    }

    funcResponse(null);
});

// ##########################################################

let funcActiveident = function() { // the id of the video the player is currently on, if any
    if (window.location.pathname === '/watch') {
        return new URLSearchParams(window.location.search).get('v');

    } else if (window.location.pathname.indexOf('/shorts/') === 0) {
        return window.location.pathname.split('/shorts/')[1].slice(0, 11);

    }

    return null;
};

let funcActivetitle = function() {
    let strTitle = window.document.title;

    if (strTitle.slice(-10) === ' - YouTube') {
        strTitle = strTitle.slice(0, -10);
    }

    strTitle = strTitle.replace(/^\(\d+\)\s*/, '');

    return strTitle.trim();
};

let funcVideoel = function() { // youtube can have several <video> elements, so pick the actual player
    if (window.location.pathname.indexOf('/shorts/') === 0) { // neighbouring shorts are preloaded with their own <video>, so scope to the active reel
        let objShorts = window.document.querySelector('ytd-reel-video-renderer[is-active] video, #shorts-player video');

        if ((objShorts !== null) && (objShorts.duration) && (isNaN(objShorts.duration) === false) && (objShorts.duration > 0)) {
            return objShorts;
        }
    }

    let objMain = window.document.querySelector('video.html5-main-video') || window.document.querySelector('.html5-video-player video');

    if ((objMain !== null) && (objMain.duration) && (isNaN(objMain.duration) === false) && (objMain.duration > 0)) {
        return objMain;
    }

    let objBest = null;

    for (let objVideoel of window.document.querySelectorAll('video')) {
        if ((objVideoel.duration) && (isNaN(objVideoel.duration) === false) && (objVideoel.duration > 0)) {
            if ((objBest === null) || (objVideoel.duration > objBest.duration)) {
                objBest = objVideoel;
            }
        }
    }

    return objBest;
};

let funcAnyvideoel = function() {
    return window.document.querySelector('video.html5-main-video') || window.document.querySelector('.html5-video-player video') || window.document.querySelector('video');
};

let funcActivelabelhide = function() {
    if ((objActivelabel !== null) && (objActivelabel.parentNode !== null)) {
        objActivelabel.parentNode.removeChild(objActivelabel);
    }
};

let funcActivelabelnode = function() {
    let objPlayer = window.document.getElementById('movie_player');

    if (objPlayer === null) {
        return null;
    }

    if (objActivelabel === null) {
        objActivelabel = window.document.createElement('div');
        objActivelabel.className = 'youwatch-active-label';
        objActivelabel.appendChild(window.document.createElement('span')).className = 'youwatch-active-icon';
        objActivelabel.appendChild(window.document.createElement('span')).className = 'youwatch-active-text';
        objActivelabel.querySelector('.youwatch-active-icon').textContent = '\u27f3';
        objActivelabel.style.left = '12px';
        objActivelabel.style.visibility = 'hidden';
        objActivelabel.style.pointerEvents = 'none';
        objActivelabel.style.position = 'absolute';
        objActivelabel.style.top = '12px';
        objActivelabel.style.zIndex = '10000';
    }

    if (objActivelabel.parentNode !== objPlayer) {
        objPlayer.appendChild(objActivelabel);
    }

    return objActivelabel;
};

let funcActivelabelstate = function(objData) {
    if ((objData === null) || (objData === undefined)) {
        return '';
    }

    let intCount = Math.max(0, parseInt(objData.intCount) || 0);
    let boolWatched = objData.strState === 'watched';
    let intPercent = Math.max(0, Math.min(100, objData.intPercent || 0));

    if ((boolWatched === false) && (intPercent === 0) && (intCount === 0)) {
        return ''; // nothing has happened with this video yet, so there is nothing worth putting over the player
    }

    let strState = boolWatched === true ? 'WATCHED' : ('WATCHING ' + intPercent + '%');

    return (intCount === 0) ? strState : (intCount + ' \u00b7 ' + strState); // no completed view means no count to report
};

let funcActiveplaying = function() {
    let objVideoel = funcAnyvideoel();

    return (objVideoel !== null) && (objVideoel.paused !== true) && (objVideoel.ended !== true);
};

let funcActivelabellookup = function(strIdent) {
    if (objActivelookups[strIdent] === true) {
        return;
    }

    objActivelookups[strIdent] = true;

    chrome.runtime.sendMessage({
        'strMessage': 'youtubeLookup',
        'strIdent': strIdent,
        'strTitle': funcActivetitle(),
    }, function(objResponse) {
        delete objActivelookups[strIdent];

        if ((objResponse !== null) && (objResponse !== undefined)) {
            delete objActivelabelmisses[objResponse.strIdent];

            objVideodata[objResponse.strIdent] = {
                'intTimestamp': objResponse.intTimestamp,
                'strState': objResponse.strState || 'watching',
                'intPercent': objResponse.intPercent || 0,
                'intCount': objResponse.intCount || 0,
                'strDebugSource': objResponse.strDebugSource || '',
                'strDebugReason': objResponse.strDebugReason || '',
                'intDebugTimestamp': objResponse.intDebugTimestamp || 0,
            };
        } else {
            objActivelabelmisses[strIdent] = true;
            objVideodata[strIdent] = {
                'intTimestamp': new Date().getTime(),
                'strState': 'watching',
                'intPercent': 0,
                'intCount': 0,
            };
        }

        if (funcActiveident() === strIdent) {
            funcActivelabelsync();
        }
    });
};

let funcActivelabelsync = function() {
    let strIdent = funcActiveident();

    if ((strIdent === null) || (strIdent.length !== 11) || (funcActiveplaying() === true)) {
        funcActivelabelhide();
        return;
    }

    if (objVideodata.hasOwnProperty(strIdent) !== true) {
        funcActivelabelhide();
        if (objActivelabelmisses[strIdent] !== true) {
            funcActivelabellookup(strIdent);
        }
        return;
    }

    let strLabel = funcActivelabelstate(objVideodata[strIdent]);

    if (strLabel === '') {
        funcActivelabelhide();
        return;
    }

    let objLabel = funcActivelabelnode();

    if (objLabel === null) {
        return;
    }

    objLabel.querySelector('.youwatch-active-text').textContent = strLabel;
    objLabel.querySelector('.youwatch-active-icon').style.display = (Math.max(0, parseInt(objVideodata[strIdent].intCount) || 0) === 0) ? 'none' : '';

    // the colours belong to the theme, so the state only picks a class - inline colours here would override the stylesheet
    objLabel.className = 'youwatch-active-label ' + (objVideodata[strIdent].strState === 'watched' ? 'youwatch-active-watched' : 'youwatch-active-watching');

    // the background injects the theme stylesheet only once the tab reports "complete", so the label would briefly render
    // as unstyled text - it stays hidden until the sheet is actually in effect and then appears already styled. the div
    // has no inline display, so a computed "flex" can only come from the stylesheet having arrived
    if (window.getComputedStyle(objLabel).display === 'flex') {
        objLabel.style.visibility = '';

    } else if (intActivelabelwait === null) {
        intActivelabelwait = window.setTimeout(function() { // the dom-dirty poll stops on a settled page, so retry on our own
            intActivelabelwait = null;

            funcActivelabelsync();
        }, 100);

    }
};

// the url (funcActiveident) updates via pushState before the player finishes swapping its stream, so right after a
// navigation or an autoplay-to-next-video the <video> element can still report the previous video's currentTime/duration
// for a brief window - asking the player api which video it actually has loaded catches that race before it is
// mistaken for the new video crossing the watched threshold
let funcPlayerident = function() {
    let objPlayer = window.document.getElementById('movie_player');

    if ((objPlayer === null) || (typeof objPlayer.getVideoData !== 'function')) {
        return null;
    }

    try {
        let objData = objPlayer.getVideoData();
        return ((objData !== null) && (objData !== undefined) && (objData.video_id)) ? objData.video_id : null;

    } catch (objError) {
        return null;
    }
};

let funcProgress = function() { // promote the active video to watched once the player crosses the threshold
    let strIdent = funcActiveident();

    if ((strIdent === null) || (strIdent.length !== 11)) {
        return;
    }

    let strPlayerident = funcPlayerident();

    if ((strPlayerident !== null) && (strPlayerident !== strIdent)) {
        return; // the player has not finished loading this video yet - its time/duration still belong to the previous one
    }

    let objVideoel = funcVideoel();

    if (objVideoel === null) {
        return;
    }

    let boolShorts = window.location.pathname.indexOf('/shorts/') === 0;

    let intPercent = Math.round((objVideoel.currentTime / objVideoel.duration) * 100);
    let intNow = new Date().getTime();
    let boolPlaying = (objVideoel.paused !== true) && (objVideoel.ended !== true) && (objVideoel.readyState >= 2);

    // a single (nearly) full play of a short is enough to count it as watched - shorts loop instead of ending, so both
    // a reading near the end and a wrap back to the start (the loop restarting) confirm a completed watch
    let intComplete = boolShorts === true ? 90 : intThreshold;
    let boolLooped = (boolShorts === true) && (boolPlaying === true) && (objReported[strIdent] !== undefined) && (objReported[strIdent] >= 50) && (intPercent < objReported[strIdent] - 40);

    if (((intPercent >= intComplete) || (boolLooped === true)) && (objCompleted[strIdent] !== true)) {
        objCompleted[strIdent] = true;

        chrome.runtime.sendMessage({
            'strMessage': 'youtubeComplete',
            'strIdent': strIdent,
            'strTitle': funcActivetitle(),
            'boolShorts': boolShorts,
        }, function(objResponse) {
            // ...
        });

    } else if ((boolShorts === true) && (objVideodata.hasOwnProperty(strIdent) === true) && (objVideodata[strIdent].strState === 'watched')) {
        // a watched short stays watched - loop restarts and re-opens must not report sub-threshold progress for it

    } else if ((intPercent < intComplete) && (objCompleted[strIdent] !== true) && (boolPlaying === true) && ((objReported[strIdent] !== intPercent) || ((intNow - (objReporttime[strIdent] || 0)) >= 60000))) {
        let boolResume = (objReported[strIdent] === undefined); // the first reading after opening reflects the resume position

        objReported[strIdent] = intPercent; // report live progress on whole-percent changes, plus a bounded periodic refresh
        objReporttime[strIdent] = intNow; // long videos can sit on the same whole percent for a while, so still refresh once a minute

        chrome.runtime.sendMessage({
            'strMessage': 'youtubeWatching',
            'strIdent': strIdent,
            'strTitle': funcActivetitle(),
            'intPercent': intPercent,
            'boolResume': boolResume,
            'boolShorts': boolShorts,
        }, function(objResponse) {
            // ...
        });

    }
};

window.setInterval(funcProgress, 15000);

window.setInterval(function() { // most shorts are over well before the 15s cadence gets a second reading, so poll every second while one is open
    if (window.location.pathname.indexOf('/shorts/') === 0) {
        funcProgress();
    }
}, 1000);

// ##########################################################

document.addEventListener('visibilitychange', async function() {
    if (document.visibilityState === 'visible') {
        await refresh();
    }
});

// ##########################################################

let eventhandler = function() {
    let strIdent = funcActiveident();
    let strProgresskey = window.location.pathname + ':' + (strIdent || '');

    if (strProgressnav !== strProgresskey) {
        strProgressnav = strProgresskey;
        objCompleted = {}; // only a real page/video change starts a fresh watch; youtube emits the events below repeatedly
        objReported = {};
        objReporttime = {};
    }

    funcActivelabelhide();

    // the mutation observer marks the dom dirty as youtube streams the thumbnails in, and the polling loop below then
    // rescans - so a single refresh here (instead of the previous brute-force burst of ~11 timeouts) catches the navigation
    boolDirty = true;
    refresh();
};

document.addEventListener('yt-service-request-completed', eventhandler); // https://github.com/sota2501/youtube-chat-ex/blob/master/docs/event.md
document.addEventListener('yt-navigate-finish', eventhandler); // https://github.com/sota2501/youtube-chat-ex/blob/master/docs/event.md
document.addEventListener('yt-page-type-changed', eventhandler); // https://github.com/sota2501/youtube-chat-ex/blob/master/docs/event.md
document.addEventListener('yt-page-data-updated', eventhandler); // https://github.com/sota2501/youtube-chat-ex/blob/master/docs/event.md
document.addEventListener('yt-visibility-refresh', eventhandler); // https://github.com/1natsu172/Outside-YouTube-Player-Bar/blob/develop/src/core/services/eventEffectServices/libs/YT_EVENTS.ts

// ##########################################################

// a dom mutation (new thumbnails scrolling in, an spa navigation swapping the page) is the only thing that makes a
// rescan worthwhile - flagging it here lets the polling loop skip the expensive querySelectorAll on idle ticks
let objMutationobserver = new MutationObserver(function() {
    boolDirty = true;
});

objMutationobserver.observe(window.document.documentElement, { 'childList': true, 'subtree': true });

window.setInterval(async function() {
    if (document.hidden === true) {
        return;
    }

    let strNav = window.location.href + ':' + window.document.title;

    if ((boolDirty === false) && (strNav === strLastnav)) {
        return; // nothing changed in the dom and we are still on the same page, so there is nothing new to mark

    }

    boolDirty = false;
    strLastnav = strNav;

    await refresh();
}, 300);
