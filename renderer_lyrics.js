const { remote, ipcRenderer } = require( 'electron' );
const request = require( 'request' );
const __ = require( './providers/translateProvider' );

const url = 'https://api.vagalume.com.br/search.php';

const window = remote.getCurrentWindow();
const elementLyric = document.getElementById( 'lyric' );
const elementDivSearchLyric = document.getElementById( 'div_search_lyric' );
const elementInputLyricArtist = document.getElementById( 'input_lyric_artist' );
const elementInputLyricSong = document.getElementById( 'input_lyric_song' );
const elementButtonSearchLyric = document.getElementById( 'btn_search_lyric' );

let lastSong;
let lastArtist;
let scrollInterval;

loadi18n();

document.getElementById( 'btn-close' ).addEventListener( 'click', function() {
    window.close();
} );

elementButtonSearchLyric.addEventListener( 'click', function() {
    getLyric( elementInputLyricArtist.value, elementInputLyricSong.value );
} );

setInterval( function() {
    ipcRenderer.send( 'what-is-song-playing-now' );
}, 1000 );

ipcRenderer.on( 'song-playing-now-is', function( e, data ) {
    getLyric( data.author, data.title )
} );

function pageScroll() {
    //document.getElementById( 'content' ).scrollBy( 0, 5 )
    clearInterval( scrollInterval );

    scrollInterval = setInterval( function() {
        document.getElementById( 'content' ).scrollBy( 0, 5 );
    }, 4000 );
    //scrollDelay = setTimeout( pageScroll, 4000 );
}

function getLyric( artist, song ) {

    if ( artist != undefined && song != undefined ) {
        if ( artist != lastArtist && song != lastSong ) {
            lastSong = song;
            lastArtist = artist;

            request( url + '?art=' + escapeHtml( artist ) + '&mus=' + escapeHtml( song ), { json: true }, function( err, res, body ) {
                if ( err ) { 
                    console.log("LYRICS ERRO");
                    elementLyric.innerText = __.trans( 'LABEL_LYRICS_NOT_FOUND' ); 
                    elementDivSearchLyric.classList.remove('hide');
                    elementInputLyricArtist.value = artist;
                    elementInputLyricSong.value = song;
                    return;
                }
                
                document.getElementById( 'now-playing' ).innerText = song + ' - ' + artist;
                if ( body.mus ) {
                    elementLyric.innerText = body.mus[ 0 ].text; 
                    elementDivSearchLyric.classList.add('hide');
                } else {
                    elementLyric.innerText = __.trans( 'LABEL_LYRICS_NOT_FOUND' );
                    elementDivSearchLyric.classList.remove('hide');
                    elementInputLyricArtist.value = artist;
                    elementInputLyricSong.value = song;
                }

                document.getElementById( 'content' ).scrollTop = 0;
    
                setTimeout( function() {
                    pageScroll();
                }, 20 * 1000 );
    
            } );

        }

    } else {
        elementLyric.innerText = __.trans( 'LABEL_PLAY_MUSIC' );
    }
    
}

function loadi18n() {
    document.getElementById( 'i18n_LABEL_LOADING' ).innerText                                     = __.trans( 'LABEL_LOADING' );
}

function escapeHtml( text ) {
    var map = {
      '&': 'and',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
  
    return text.replace( /[&<>"']/g, function( m ) { return map[ m ]; } );
  }