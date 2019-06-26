const __ = require( './translateProvider' );
const path = require('path');

function mediaPlayPauseTrack( mainWindow ) {
    mainWindow.webContents.sendInputEvent( { type:'keydown', keyCode: ';' } );
    console.log('mediaPlayPause');
}

function mediaStopTrack( mainWindow ) {
    mainWindow.webContents.sendInputEvent( { type:'keydown', keyCode: ';' } );
    console.log('mediaStop');
}

function mediaNextTrack( mainWindow ) {
    mainWindow.webContents.sendInputEvent( { type:'keydown', keyCode: 'j' } );
    console.log('mediaNext');
}

function mediaPreviousTrack( mainWindow ) {
    mainWindow.webContents.sendInputEvent( { type:'keydown', keyCode: 'k' } );
    console.log('mediaPrevious');
}

function mediaUpVote( mainWindow ) {
    mainWindow.webContents.sendInputEvent( { type:'keydown', keyCode: '+' } );
    console.log('mediaUpVote');
}

function mediaDownVote( mainWindow ) {
    mainWindow.webContents.sendInputEvent( { type:'keydown', keyCode: '-' } );
    console.log('mediaDownVote');
}

function createThumbar( mainWindow, type, likeStatus ) {
    let thumbsUp = '../assets/img/controls/thumbs-up-button-outline.png';
    let thumbsDown = '../assets/img/controls/thumbs-down-button-outline.png';
    let thumbsReverse = '';

    switch( likeStatus ) {
        case 'LIKE':
            thumbsUp = '../assets/img/controls/thumbs-up-button.png';
            thumbsDown = '../assets/img/controls/thumbs-down-button-outline.png';
            thumbsReverse = 'INDIFFERENT';
            break;
        
        case 'DISLIKE':
            thumbsUp = '../assets/img/controls/thumbs-up-button-outline.png';
            thumbsDown = '../assets/img/controls/thumbs-down-button.png';
            thumbsReverse = 'INDIFFERENT';
            break;

        case 'INDIFFERENT':
            thumbsUp = '../assets/img/controls/thumbs-up-button-outline.png';
            thumbsDown = '../assets/img/controls/thumbs-down-button-outline.png';
            thumbsReverse = ( likeStatus == 'LIKE' ) ? 'DISLIKE' : 'LIKE';
            break;
    }

    playOrPause = {
        tooltip: __.trans( 'MEDIA_CONTROL_PLAY' ),
        icon: path.join( __dirname, '../assets/img/controls/play-button.png' ),
        click: function() { mediaPlayPauseTrack( mainWindow.getBrowserView() ) }
    }

    if ( type !== 'play' ) {
        playOrPause.tooltip = __.trans( 'MEDIA_CONTROL_PAUSE' );
        playOrPause.icon = path.join( __dirname, '../assets/img/controls/pause-button.png' );
    }

    mainWindow.setThumbarButtons([
        {
            tooltip: __.trans( 'MEDIA_CONTROL_THUMBS_DOWN' ),
            icon: path.join( __dirname, thumbsDown ),
            click: function() { mediaDownVote( mainWindow.getBrowserView(), createThumbar( mainWindow, type, thumbsReverse ) ) }
        },
        {
            icon: path.join( __dirname, '../assets/img/null.png' ),
            flags: [ 'disabled', 'nobackground' ]
        },
        {
            tooltip: __.trans( 'MEDIA_CONTROL_PREVIOUS' ),
            icon: path.join( __dirname, '../assets/img/controls/play-previous-button.png' ),
            click: function() { mediaPreviousTrack( mainWindow.getBrowserView() ) }
        },
        {
            tooltip: playOrPause.tooltip,
            icon: playOrPause.icon,
            click: function() { mediaPlayPauseTrack( mainWindow.getBrowserView() ) }
        },
        {
            tooltip: __.trans( 'MEDIA_CONTROL_NEXT' ),
            icon: path.join( __dirname, '../assets/img/controls/play-next-button.png' ),
            click: function() { mediaNextTrack( mainWindow.getBrowserView() ) }
        },
        {
            icon: path.join( __dirname, '../assets/img/null.png' ),
            flags: [ 'disabled', 'nobackground' ]
        },
        {
            tooltip: __.trans( 'MEDIA_CONTROL_THUMBS_UP' ),
            icon: path.join( __dirname, thumbsUp ),
            click: function() { mediaUpVote( mainWindow.getBrowserView(), createThumbar( mainWindow, type, thumbsReverse ) ) },
        }
    ]);
}

function createTouchBar( mainWindow ) {
    // TODO: Implement touchbar 
    // mainWindow.setTouchBar();
}

const guarder = (mainWindow,f) => {if (mainWindow && mainWindow.webContents) f(mainWindow)};

exports.playPauseTrack = (v)=>guarder(v,mediaPlayPauseTrack);
exports.stopTrack = (v)=>guarder(v,mediaStopTrack);
exports.nextTrack = (v)=>guarder(v,mediaNextTrack);
exports.previousTrack = (v)=>guarder(v,mediaPreviousTrack);
exports.upVote = (v)=>guarder(v,mediaUpVote);
exports.downVote = (v)=>guarder(v,mediaDownVote);

// For Windows
exports.createThumbar = createThumbar;
// For Mac
// exports.createTouchBar = createTouchBar;