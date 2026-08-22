'use strict';

// shared between the service worker (background.js), the watchlist background (watchlist/background.js) and the
// page-world content script (hooks.js) - loaded via importScripts in a chrome service worker, and via the manifest
// (background.scripts / a MAIN-world content_scripts entry) in firefox. keep it free of chrome.* and DOM globals.

// finds the first balanced json object at the start of strJson and parses it. it is string-aware so a brace inside a
// video title (eg "How to use {} in code") no longer throws off the depth counter and drops that video from parsing.
let funcHackyparse = function(strJson) {
    let intCount = 0;
    let boolString = false;
    let boolEscape = false;
    let intLength = 0;

    for (intLength = 0; intLength < strJson.length; intLength += 1) {
        let strChar = strJson[intLength];

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
            intCount += 1;

        } else if (strChar === '}') {
            intCount -= 1;

            if (intCount === 0) {
                intLength += 1;

                break;
            }
        }
    }

    try {
        return JSON.parse(strJson.substr(0, intLength));
    } catch (objError) {
        // ...
    }

    return null;
};

// each renderer flavour youtube uses to embed a video in an api response: the marker the response is split on, the
// substring that must be present when only progress-bearing entries are wanted (boolProgress), and getters for the
// id and the title (the first title getter that yields one wins)
let objRendererkinds = [
    {
        'strPrefix': '{"lockupViewModel":',
        'strProgress': '"thumbnailOverlayProgressBarViewModel"',
        'funcIdent': function(objVideo) { return objVideo['lockupViewModel']['contentId']; },
        'funcTitles': [
            function(objVideo) { return objVideo['lockupViewModel']['metadata']['lockupMetadataViewModel']['title']['content']; },
            function(objVideo) { return objVideo['lockupViewModel']['rendererContext']['accessibilityContext']['label']; },
        ],
    },
    {
        'strPrefix': '{"videoWithContextRenderer":',
        'strProgress': '"startTimeSeconds"',
        'funcIdent': function(objVideo) { return objVideo['videoWithContextRenderer']['videoId']; },
        'funcTitles': [
            function(objVideo) { return objVideo['videoWithContextRenderer']['headline']['runs'][0]['text']; },
            function(objVideo) { return objVideo['videoWithContextRenderer']['headline']['accessibility']['accessibilityData']['label']; },
        ],
    },
    {
        'strPrefix': '{"videoRenderer":{"videoId":"',
        'strProgress': '"percentDurationWatched"',
        'funcIdent': function(objVideo) { return objVideo['videoRenderer']['videoId']; },
        'funcTitles': [
            function(objVideo) { return objVideo['videoRenderer']['title']['runs'][0]['text']; },
        ],
    },
    {
        'strPrefix': '{"compactVideoRenderer":{"videoId":"',
        'strProgress': '"percentDurationWatched"',
        'funcIdent': function(objVideo) { return objVideo['compactVideoRenderer']['videoId']; },
        'funcTitles': [
            function(objVideo) { return objVideo['compactVideoRenderer']['title']['runs'][0]['text']; },
        ],
    },
    {
        'strPrefix': '{"playlistVideoRenderer":{"videoId":"',
        'strProgress': '"percentDurationWatched"',
        'funcIdent': function(objVideo) { return objVideo['playlistVideoRenderer']['videoId']; },
        'funcTitles': [
            function(objVideo) { return objVideo['playlistVideoRenderer']['title']['runs'][0]['text']; },
        ],
    },
];

let funcParsevideos = function(strText, boolProgress) {
    let objVideos = [];

    if (strText.indexOf('\\x22responseContext\\x22') !== -1) {
        strText = strText.replace(new RegExp('\\\\x([0-9a-f][0-9a-f])', 'g'), function(objMatch) {
            return String.fromCharCode(parseInt(objMatch.substr(2), 16));
        });
    }

    for (let objKind of objRendererkinds) {
        for (let strVideo of strText.split(objKind.strPrefix).slice(1)) {
            let objVideo = funcHackyparse(objKind.strPrefix + strVideo);

            if (objVideo === null) {
                continue;
            }

            if ((boolProgress === true) && (JSON.stringify(objVideo).indexOf(objKind.strProgress) === -1)) {
                continue;
            }

            let strIdent = null;
            let strTitle = null;

            try {
                strIdent = objKind.funcIdent(objVideo);
            } catch (objError) {
                // ...
            }

            for (let funcTitle of objKind.funcTitles) {
                if (strTitle === null) {
                    try {
                        strTitle = funcTitle(objVideo);
                    } catch (objError) {
                        // ...
                    }
                }
            }

            if ((typeof strIdent !== 'string') || (strIdent.length !== 11) || (strTitle === null)) {
                continue;
            }

            objVideos.push({
                'objVideo': objVideo,
                'strIdent': strIdent,
                'strTitle': strTitle,
            })
        }
    }

    return objVideos;
};

let funcPercent = function(objVideo) { // the resume progress bar (red line) reports how much of the video has been watched
    let strJson = JSON.stringify(objVideo);
    let objMatch = null;

    if ((objMatch = strJson.match(/"percentDurationWatched":\s*(\d+)/)) !== null) {
        return parseInt(objMatch[1]); // videoRenderer / compactVideoRenderer / playlistVideoRenderer carry it directly
    }

    let intIdx = strJson.indexOf('"thumbnailOverlayProgressBarViewModel"');

    if (intIdx !== -1) {
        let intOpen = strJson.indexOf('{', intIdx + '"thumbnailOverlayProgressBarViewModel"'.length);

        if (intOpen !== -1) {
            // the newer lockupViewModel exposes the watched extent through the resume bar view model; use funcHackyparse
            // instead of a flat-object regex so nested objects inside the view model (eg thumbnail images) don't break the match
            let objProgressBar = funcHackyparse(strJson.slice(intOpen));

            if (objProgressBar !== null) {
                let strProgressJson = JSON.stringify(objProgressBar);
                let objMatchPDW = strProgressJson.match(/"percentDurationWatched":\s*(\d+)/);

                if (objMatchPDW !== null) {
                    return parseInt(objMatchPDW[1]);
                }

                // the progress bar has two segments: the filled portion (endPercent = watch position) and
                // the background track (endPercent = 100); taking the minimum isolates the actual progress
                let intPercent = null;

                for (let objIter of strProgressJson.matchAll(/"endPercent":\s*(\d+)/g)) {
                    let intVal = parseInt(objIter[1]);
                    intPercent = (intPercent === null) ? intVal : Math.min(intPercent, intVal);
                }

                return intPercent;
            }
        }
    }

    return null;
};

// resolves the state of a stored / imported record. a stored record must always carry a valid state - a missing one
// means data corruption or a parse/import that dropped it, so instead of silently defaulting to watched (irreversible
// and invisible) we surface it as watching (reversible and visible) and warn so the cause can be tracked down.
let funcStoredstate = function(objRecord, strContext) {
    if ((objRecord === undefined) || (objRecord === null)) {
        return 'watching';
    }

    if ((objRecord.strState === 'watched') || (objRecord.strState === 'watching')) {
        return objRecord.strState;
    }

    console.warn('[YWM state] stored record is missing a valid state - treating as watching', {
        'strContext': strContext || '',
        'strIdent': objRecord.strIdent || '',
        'strState': (objRecord.strState === undefined) ? null : objRecord.strState,
        'intPercent': (objRecord.intPercent === undefined) ? null : objRecord.intPercent,
    });

    return 'watching';
};

// attach to the global explicitly so the functions resolve the same way whether this file is pulled in via importScripts
// (chrome service worker), the background.scripts array (firefox) or a MAIN-world content_scripts entry (hooks.js)
globalThis.funcHackyparse = funcHackyparse;
globalThis.funcParsevideos = funcParsevideos;
globalThis.funcPercent = funcPercent;
globalThis.funcStoredstate = funcStoredstate;
