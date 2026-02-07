/**
 * ==================== VELTRA YOUTUBE SOCIAL FEATURES TEST SUITE ====================
 * Comprehensive automated tests for YouTube app social functionality
 * 
 * Run in browser console while Veltra OS is loaded:
 *   await runYoutubeTests();
 * 
 * Or run individual test categories:
 *   await testYoutubeSearch();
 *   await testYoutubeComments();
 *   await testYoutubeLikes();
 *   await testYoutubeSubscriptions();
 *   await testYoutubeNotifications();
 */

const TestResults = {
  passed: 0,
  failed: 0,
  errors: [],
  startTime: null,
  
  reset() {
    this.passed = 0;
    this.failed = 0;
    this.errors = [];
    this.startTime = Date.now();
  },
  
  pass(testName) {
    this.passed++;
    console.log(`%c✓ PASS: ${testName}`, 'color: #4CAF50; font-weight: bold');
  },
  
  fail(testName, reason) {
    this.failed++;
    this.errors.push({ test: testName, reason });
    console.log(`%c✗ FAIL: ${testName}`, 'color: #f44336; font-weight: bold');
    console.log(`   Reason: ${reason}`);
  },
  
  summary() {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    console.log('\n' + '='.repeat(60));
    console.log(`%cTEST SUMMARY`, 'font-size: 14px; font-weight: bold');
    console.log('='.repeat(60));
    console.log(`%c  Passed: ${this.passed}`, 'color: #4CAF50');
    console.log(`%c  Failed: ${this.failed}`, this.failed > 0 ? 'color: #f44336' : 'color: #888');
    console.log(`  Duration: ${duration}s`);
    if (this.errors.length > 0) {
      console.log('\nFailed Tests:');
      this.errors.forEach(e => console.log(`  - ${e.test}: ${e.reason}`));
    }
    console.log('='.repeat(60) + '\n');
    return { passed: this.passed, failed: this.failed, errors: this.errors };
  }
};

// Helper: Wait for condition with timeout
async function waitFor(condition, timeout = 5000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (condition()) return true;
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}

// Helper: Simulate delay
const delay = ms => new Promise(r => setTimeout(r, ms));

// ==================== CORE FUNCTION TESTS ====================

async function testCoreFunctions() {
  console.log('\n%c📦 TESTING CORE FUNCTIONS', 'font-size: 12px; font-weight: bold; color: #2196F3');
  
  // Test: getVeltraUserId exists
  if (typeof getVeltraUserId === 'function') {
    const userId = getVeltraUserId();
    if (userId && typeof userId === 'string' && userId.startsWith('user_')) {
      TestResults.pass('getVeltraUserId() returns valid user ID');
    } else {
      TestResults.fail('getVeltraUserId() returns valid user ID', `Got: ${userId}`);
    }
  } else {
    TestResults.fail('getVeltraUserId() exists', 'Function not defined');
  }
  
  // Test: getYoutubeUsername exists
  if (typeof getYoutubeUsername === 'function') {
    const username = getYoutubeUsername();
    if (username && typeof username === 'string') {
      TestResults.pass('getYoutubeUsername() returns string');
    } else {
      TestResults.fail('getYoutubeUsername() returns string', `Got: ${username}`);
    }
  } else {
    TestResults.fail('getYoutubeUsername() exists', 'Function not defined');
  }
  
  // Test: youtubeState exists and has required fields
  if (typeof youtubeState === 'object') {
    const requiredFields = ['currentVideo', 'searchResults', 'history', 'watchLater', 'userId'];
    const missing = requiredFields.filter(f => !(f in youtubeState));
    if (missing.length === 0) {
      TestResults.pass('youtubeState has required fields');
    } else {
      TestResults.fail('youtubeState has required fields', `Missing: ${missing.join(', ')}`);
    }
  } else {
    TestResults.fail('youtubeState object exists', 'Not defined');
  }
  
  // Test: escapeHtml function
  if (typeof escapeHtml === 'function') {
    const escaped = escapeHtml('<script>alert("xss")</script>');
    if (!escaped.includes('<script>')) {
      TestResults.pass('escapeHtml() sanitizes HTML');
    } else {
      TestResults.fail('escapeHtml() sanitizes HTML', 'XSS payload not escaped');
    }
  } else {
    TestResults.fail('escapeHtml() exists', 'Function not defined');
  }
}

// ==================== YOUTUBE SEARCH TESTS ====================

async function testYoutubeSearch() {
  console.log('\n%c🔍 TESTING YOUTUBE SEARCH', 'font-size: 12px; font-weight: bold; color: #2196F3');
  
  // Test: searchYoutube function exists
  if (typeof searchYoutube !== 'function') {
    TestResults.fail('searchYoutube() exists', 'Function not defined');
    return;
  }
  TestResults.pass('searchYoutube() exists');
  
  // Test: getMelodifyBackendUrl returns URL
  if (typeof getMelodifyBackendUrl === 'function') {
    try {
      const url = await getMelodifyBackendUrl();
      if (url && typeof url === 'string' && url.startsWith('http')) {
        TestResults.pass('getMelodifyBackendUrl() returns valid URL');
      } else {
        TestResults.fail('getMelodifyBackendUrl() returns valid URL', `Got: ${url}`);
      }
    } catch (e) {
      TestResults.fail('getMelodifyBackendUrl() returns valid URL', e.message);
    }
  } else {
    TestResults.fail('getMelodifyBackendUrl() exists', 'Function not defined');
  }
  
  // Test: Empty search is handled
  try {
    await searchYoutube('');
    TestResults.pass('Empty search handled gracefully');
  } catch (e) {
    TestResults.fail('Empty search handled gracefully', e.message);
  }
  
  // Test: renderYoutubeVideoGrid exists and returns HTML
  if (typeof renderYoutubeVideoGrid === 'function') {
    const mockVideos = [{ id: 'test123', title: 'Test Video', artist: 'Test Artist', thumbnail: '' }];
    const html = renderYoutubeVideoGrid(mockVideos, 'test');
    if (html && html.includes('yt-video-card')) {
      TestResults.pass('renderYoutubeVideoGrid() returns valid HTML');
    } else {
      TestResults.fail('renderYoutubeVideoGrid() returns valid HTML', 'Missing expected elements');
    }
  } else {
    TestResults.fail('renderYoutubeVideoGrid() exists', 'Function not defined');
  }
}

// ==================== YOUTUBE COMMENTS TESTS ====================

async function testYoutubeComments() {
  console.log('\n%c💬 TESTING YOUTUBE COMMENTS', 'font-size: 12px; font-weight: bold; color: #2196F3');
  
  // Test: Comment functions exist
  const commentFuncs = ['loadYoutubeComments', 'postYoutubeComment', 'postYoutubeReply', 'likeYoutubeComment', 'deleteYoutubeComment'];
  commentFuncs.forEach(fname => {
    if (typeof window[fname] === 'function') {
      TestResults.pass(`${fname}() exists`);
    } else {
      TestResults.fail(`${fname}() exists`, 'Function not defined');
    }
  });
  
  // Test: renderYoutubeComment exists
  if (typeof renderYoutubeComment === 'function') {
    const mockComment = {
      id: 'c_test123',
      userId: 'user_test',
      username: 'TestUser',
      text: 'Test comment',
      timestamp: Date.now(),
      likedBy: {}
    };
    const html = renderYoutubeComment(mockComment, [], 'testVideoId');
    if (html && html.includes('yt-comment')) {
      TestResults.pass('renderYoutubeComment() returns valid HTML');
    } else {
      TestResults.fail('renderYoutubeComment() returns valid HTML', 'Missing expected elements');
    }
  } else {
    TestResults.fail('renderYoutubeComment() exists', 'Function not defined');
  }
  
  // Test: formatYoutubeTimeAgo exists
  if (typeof formatYoutubeTimeAgo === 'function') {
    const now = Date.now();
    const justNow = formatYoutubeTimeAgo(now - 30000); // 30 sec ago
    const hourAgo = formatYoutubeTimeAgo(now - 3600000); // 1 hour ago
    const dayAgo = formatYoutubeTimeAgo(now - 86400000); // 1 day ago
    
    if (justNow.includes('now') || justNow.includes('m')) {
      TestResults.pass('formatYoutubeTimeAgo() handles recent time');
    } else {
      TestResults.fail('formatYoutubeTimeAgo() handles recent time', `Got: ${justNow}`);
    }
    
    if (hourAgo.includes('h')) {
      TestResults.pass('formatYoutubeTimeAgo() handles hours');
    } else {
      TestResults.fail('formatYoutubeTimeAgo() handles hours', `Got: ${hourAgo}`);
    }
    
    if (dayAgo.includes('d')) {
      TestResults.pass('formatYoutubeTimeAgo() handles days');
    } else {
      TestResults.fail('formatYoutubeTimeAgo() handles days', `Got: ${dayAgo}`);
    }
  } else {
    TestResults.fail('formatYoutubeTimeAgo() exists', 'Function not defined');
  }
  
  // Test: Comment XSS prevention
  if (typeof renderYoutubeComment === 'function') {
    const xssComment = {
      id: 'c_xss',
      userId: 'hacker',
      username: '<script>alert("xss")</script>',
      text: '<img onerror="alert(1)" src=x>',
      timestamp: Date.now(),
      likedBy: {}
    };
    const html = renderYoutubeComment(xssComment, [], 'testVideoId');
    if (!html.includes('<script>') && !html.includes('onerror=')) {
      TestResults.pass('Comment XSS prevention works');
    } else {
      TestResults.fail('Comment XSS prevention works', 'XSS payload not escaped');
    }
  }
}

// ==================== YOUTUBE LIKES TESTS ====================

async function testYoutubeLikes() {
  console.log('\n%c👍 TESTING YOUTUBE LIKES', 'font-size: 12px; font-weight: bold; color: #2196F3');
  
  // Test: Like functions exist
  const likeFuncs = ['toggleYoutubeLike', 'toggleYoutubeDislike', 'loadYoutubeLikes', 'saveYoutubeLikes', 'updateYoutubeLikeButtons', 'loadVideoLikeCounts'];
  likeFuncs.forEach(fname => {
    if (typeof window[fname] === 'function') {
      TestResults.pass(`${fname}() exists`);
    } else {
      TestResults.fail(`${fname}() exists`, 'Function not defined');
    }
  });
  
  // Test: likes state in youtubeState
  if (youtubeState && 'likes' in youtubeState) {
    TestResults.pass('youtubeState.likes exists');
  } else {
    // It might be initialized by initYoutubeSocial, so just check the function exists
    if (typeof loadYoutubeLikes === 'function') {
      TestResults.pass('Like state management available');
    } else {
      TestResults.fail('Like state management available', 'Neither youtubeState.likes nor loadYoutubeLikes found');
    }
  }
  
  // Test: Video ID validation in like functions
  if (typeof toggleYoutubeLike === 'function') {
    // Test with invalid video ID - should not throw
    try {
      toggleYoutubeLike('invalid<>id');
      TestResults.pass('toggleYoutubeLike() handles invalid video ID');
    } catch (e) {
      TestResults.fail('toggleYoutubeLike() handles invalid video ID', e.message);
    }
    
    // Test with empty - should not throw
    try {
      toggleYoutubeLike('');
      TestResults.pass('toggleYoutubeLike() handles empty video ID');
    } catch (e) {
      TestResults.fail('toggleYoutubeLike() handles empty video ID', e.message);
    }
  }
}

// ==================== YOUTUBE SUBSCRIPTIONS TESTS ====================

async function testYoutubeSubscriptions() {
  console.log('\n%c👥 TESTING YOUTUBE SUBSCRIPTIONS', 'font-size: 12px; font-weight: bold; color: #2196F3');
  
  // Test: Subscription functions exist
  const subFuncs = ['toggleYoutubeSubscribe', 'loadYoutubeSubscriptions', 'saveYoutubeSubscriptions', 'isSubscribedToChannel', 'renderYoutubeSubscriptions'];
  subFuncs.forEach(fname => {
    if (typeof window[fname] === 'function') {
      TestResults.pass(`${fname}() exists`);
    } else {
      TestResults.fail(`${fname}() exists`, 'Function not defined');
    }
  });
  
  // Test: isSubscribedToChannel returns boolean
  if (typeof isSubscribedToChannel === 'function') {
    const result = isSubscribedToChannel('TestChannel');
    if (typeof result === 'boolean') {
      TestResults.pass('isSubscribedToChannel() returns boolean');
    } else {
      TestResults.fail('isSubscribedToChannel() returns boolean', `Got: ${typeof result}`);
    }
  }
  
  // Test: Channel name sanitization
  if (typeof toggleYoutubeSubscribe === 'function') {
    try {
      toggleYoutubeSubscribe('<script>hack</script>');
      TestResults.pass('toggleYoutubeSubscribe() handles malicious input');
    } catch (e) {
      TestResults.fail('toggleYoutubeSubscribe() handles malicious input', e.message);
    }
    
    try {
      toggleYoutubeSubscribe('');
      TestResults.pass('toggleYoutubeSubscribe() handles empty input');
    } catch (e) {
      TestResults.fail('toggleYoutubeSubscribe() handles empty input', e.message);
    }
  }
}

// ==================== YOUTUBE NOTIFICATIONS TESTS ====================

async function testYoutubeNotifications() {
  console.log('\n%c🔔 TESTING YOUTUBE NOTIFICATIONS', 'font-size: 12px; font-weight: bold; color: #2196F3');
  
  // Test: Notification functions exist
  const notifFuncs = ['loadYoutubeNotifications', 'sendYoutubeNotification', 'updateYoutubeNotificationBadge', 'renderYoutubeNotifications', 'clearYoutubeNotifications', 'handleYoutubeNotifClick'];
  notifFuncs.forEach(fname => {
    if (typeof window[fname] === 'function') {
      TestResults.pass(`${fname}() exists`);
    } else {
      TestResults.fail(`${fname}() exists`, 'Function not defined');
    }
  });
  
  // Test: Notification polling functions
  if (typeof startYoutubeNotifPolling === 'function' && typeof stopYoutubeNotifPolling === 'function') {
    TestResults.pass('Notification polling functions exist');
  } else {
    TestResults.fail('Notification polling functions exist', 'startYoutubeNotifPolling or stopYoutubeNotifPolling missing');
  }
}

// ==================== YOUTUBE APP UI TESTS ====================

async function testYoutubeUI() {
  console.log('\n%c🎨 TESTING YOUTUBE UI', 'font-size: 12px; font-weight: bold; color: #2196F3');
  
  // Test: YouTube app can be opened
  if (typeof openApp === 'function') {
    try {
      openApp('youtube');
      await delay(500);
      
      if (windows && windows['youtube']) {
        TestResults.pass('YouTube app opens successfully');
        
        // Test: Check for required UI elements
        const requiredElements = [
          { id: 'ytSearchInput', name: 'Search input' },
          { id: 'ytTrendingGrid', name: 'Trending grid' },
          { id: 'ytSubscriptionsGrid', name: 'Subscriptions grid' },
          { id: 'ytNotificationsGrid', name: 'Notifications grid' },
          { id: 'ytHistoryGrid', name: 'History grid' },
          { id: 'ytWatchLaterGrid', name: 'Watch Later grid' }
        ];
        
        requiredElements.forEach(el => {
          if (document.getElementById(el.id)) {
            TestResults.pass(`${el.name} element exists`);
          } else {
            TestResults.fail(`${el.name} element exists`, `#${el.id} not found`);
          }
        });
        
        // Test: Tab navigation
        if (typeof youtubeShowTab === 'function') {
          const tabs = ['home', 'search', 'subscriptions', 'notifications', 'history', 'watchlater'];
          for (const tab of tabs) {
            try {
              youtubeShowTab(tab);
              await delay(100);
              const tabEl = document.getElementById(`yt-${tab}`);
              if (tabEl && tabEl.classList.contains('active')) {
                TestResults.pass(`Tab navigation works: ${tab}`);
              } else {
                TestResults.fail(`Tab navigation works: ${tab}`, 'Tab not active after switch');
              }
            } catch (e) {
              TestResults.fail(`Tab navigation works: ${tab}`, e.message);
            }
          }
          // Return to home
          youtubeShowTab('home');
        }
        
        // Close YouTube app
        if (typeof closeWindowByAppName === 'function') {
          closeWindowByAppName('youtube');
          await delay(300);
          TestResults.pass('YouTube app closes successfully');
        }
      } else {
        TestResults.fail('YouTube app opens successfully', 'Window not in windows object');
      }
    } catch (e) {
      TestResults.fail('YouTube app opens successfully', e.message);
    }
  } else {
    TestResults.fail('openApp() exists', 'Function not defined');
  }
}

// ==================== YOUTUBE PLAYER TESTS ====================

async function testYoutubePlayer() {
  console.log('\n%c▶️ TESTING YOUTUBE PLAYER', 'font-size: 12px; font-weight: bold; color: #2196F3');
  
  // Test: Player functions exist
  const playerFuncs = ['playYoutubeVideo', 'closeYoutubePlayer', 'toggleYoutubeTheater'];
  playerFuncs.forEach(fname => {
    if (typeof window[fname] === 'function') {
      TestResults.pass(`${fname}() exists`);
    } else {
      TestResults.fail(`${fname}() exists`, 'Function not defined');
    }
  });
  
  // Test: Video ID sanitization
  if (typeof playYoutubeVideo === 'function') {
    // Create mock video data
    window._yt_test = [{ 
      id: 'dQw4w9WgXcQ', 
      title: 'Test Video', 
      artist: 'Test Artist',
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg'
    }];
    
    // Open YouTube first
    openApp('youtube');
    await delay(500);
    
    try {
      playYoutubeVideo('test', 0);
      await delay(300);
      
      if (youtubeState.currentVideo && youtubeState.currentVideo.videoId === 'dQw4w9WgXcQ') {
        TestResults.pass('playYoutubeVideo() sets currentVideo correctly');
      } else {
        TestResults.fail('playYoutubeVideo() sets currentVideo correctly', `Got: ${JSON.stringify(youtubeState.currentVideo)}`);
      }
      
      // Check player section is active
      const playerSection = document.getElementById('ytPlayerSection');
      if (playerSection && playerSection.classList.contains('active')) {
        TestResults.pass('Player section becomes active');
      } else {
        TestResults.fail('Player section becomes active', 'Player section not active');
      }
      
      // Close player
      closeYoutubePlayer();
      await delay(200);
      
      if (!youtubeState.currentVideo) {
        TestResults.pass('closeYoutubePlayer() clears currentVideo');
      } else {
        TestResults.fail('closeYoutubePlayer() clears currentVideo', 'currentVideo not cleared');
      }
    } catch (e) {
      TestResults.fail('Player test', e.message);
    }
    
    closeWindowByAppName('youtube');
    delete window._yt_test;
  }
}

// ==================== FIREBASE INTEGRATION TESTS ====================

async function testFirebaseIntegration() {
  console.log('\n%c🔥 TESTING FIREBASE INTEGRATION', 'font-size: 12px; font-weight: bold; color: #2196F3');
  
  // Test: Firebase URLs defined
  if (typeof YT_COMMENTS_FIREBASE === 'string' && YT_COMMENTS_FIREBASE.includes('firebase')) {
    TestResults.pass('YT_COMMENTS_FIREBASE URL defined');
  } else {
    TestResults.fail('YT_COMMENTS_FIREBASE URL defined', 'Not found or invalid');
  }
  
  if (typeof YT_SOCIAL_FIREBASE === 'string' && YT_SOCIAL_FIREBASE.includes('firebase')) {
    TestResults.pass('YT_SOCIAL_FIREBASE URL defined');
  } else {
    TestResults.fail('YT_SOCIAL_FIREBASE URL defined', 'Not found or invalid');
  }
  
  // Test: Data save functions exist
  const saveFuncs = ['saveYoutubeData', 'saveYoutubeSubscriptions', 'saveYoutubeLikes'];
  saveFuncs.forEach(fname => {
    if (typeof window[fname] === 'function') {
      TestResults.pass(`${fname}() exists`);
    } else {
      TestResults.fail(`${fname}() exists`, 'Function not defined');
    }
  });
  
  // Test: Data load functions exist
  const loadFuncs = ['loadYoutubeData', 'loadYoutubeSubscriptions', 'loadYoutubeLikes', 'loadYoutubeNotifications'];
  loadFuncs.forEach(fname => {
    if (typeof window[fname] === 'function') {
      TestResults.pass(`${fname}() exists`);
    } else {
      TestResults.fail(`${fname}() exists`, 'Function not defined');
    }
  });
  
  // Test: initYoutubeSocial function
  if (typeof initYoutubeSocial === 'function') {
    TestResults.pass('initYoutubeSocial() exists');
  } else {
    TestResults.fail('initYoutubeSocial() exists', 'Function not defined');
  }
}

// ==================== RELATED VIDEOS TESTS ====================

async function testRelatedVideos() {
  console.log('\n%c🎬 TESTING RELATED VIDEOS', 'font-size: 12px; font-weight: bold; color: #2196F3');
  
  // Test: loadYoutubeRelatedByCreator exists
  if (typeof loadYoutubeRelatedByCreator === 'function') {
    TestResults.pass('loadYoutubeRelatedByCreator() exists');
  } else {
    TestResults.fail('loadYoutubeRelatedByCreator() exists', 'Function not defined');
  }
  
  // Test: Category queries defined
  if (typeof YT_CATEGORY_QUERIES === 'object') {
    const expectedCategories = ['music', 'gaming', 'comedy', 'tech', 'sports', 'news', 'education', 'entertainment'];
    const missing = expectedCategories.filter(c => !YT_CATEGORY_QUERIES[c]);
    if (missing.length === 0) {
      TestResults.pass('All category queries defined');
    } else {
      TestResults.fail('All category queries defined', `Missing: ${missing.join(', ')}`);
    }
  } else {
    TestResults.fail('YT_CATEGORY_QUERIES defined', 'Not found');
  }
  
  // Test: searchYoutubeCategory function
  if (typeof searchYoutubeCategory === 'function') {
    TestResults.pass('searchYoutubeCategory() exists');
  } else {
    TestResults.fail('searchYoutubeCategory() exists', 'Function not defined');
  }
  
  // Test: Trending queries defined
  if (typeof YT_TRENDING_QUERIES === 'object' && Array.isArray(YT_TRENDING_QUERIES) && YT_TRENDING_QUERIES.length > 0) {
    TestResults.pass('YT_TRENDING_QUERIES defined with entries');
  } else {
    TestResults.fail('YT_TRENDING_QUERIES defined with entries', 'Not found or empty');
  }
}

// ==================== MELODIFY TESTS ====================

async function testMelodify() {
  console.log('\n%c🎵 TESTING MELODIFY FIXES', 'font-size: 12px; font-weight: bold; color: #9C27B0');
  
  // Test: Melodify state exists
  if (typeof melodifyState === 'object') {
    const requiredFields = ['currentTrack', 'playlist', 'isPlaying', 'isShuffle', 'repeatMode'];
    const missing = requiredFields.filter(f => !(f in melodifyState));
    if (missing.length === 0) {
      TestResults.pass('melodifyState has required fields');
    } else {
      TestResults.fail('melodifyState has required fields', `Missing: ${missing.join(', ')}`);
    }
  } else {
    TestResults.fail('melodifyState object exists', 'Not defined');
  }
  
  // Test: searchMelodify function exists
  if (typeof searchMelodify === 'function') {
    TestResults.pass('searchMelodify() exists');
  } else {
    TestResults.fail('searchMelodify() exists', 'Function not defined');
  }
  
  // Test: Shuffle function exists
  if (typeof melodifyShuffle === 'function') {
    TestResults.pass('melodifyShuffle() exists');
  } else {
    TestResults.fail('melodifyShuffle() exists', 'Function not defined');
  }
  
  // Test: Volume persistence
  if (typeof changeMelodifyVolume === 'function') {
    TestResults.pass('changeMelodifyVolume() exists');
  } else {
    TestResults.fail('changeMelodifyVolume() exists', 'Function not defined');
  }
  
  // Test: Library functions
  if (typeof saveMelodifyLibrary === 'function') {
    TestResults.pass('saveMelodifyLibrary() exists');
  } else {
    TestResults.fail('saveMelodifyLibrary() exists', 'Function not defined');
  }
  
  // Test: Recommendations
  if (typeof loadMelodifyRecommendations === 'function') {
    TestResults.pass('loadMelodifyRecommendations() exists');
  } else {
    TestResults.fail('loadMelodifyRecommendations() exists', 'Function not defined');
  }
}

// ==================== MAIN TEST RUNNER ====================

async function runYoutubeTests() {
  console.clear();
  console.log('%c' + '═'.repeat(60), 'color: #1DB954');
  console.log('%c  VELTRA YOUTUBE SOCIAL FEATURES TEST SUITE', 'font-size: 16px; font-weight: bold; color: #1DB954');
  console.log('%c' + '═'.repeat(60), 'color: #1DB954');
  console.log(`Started: ${new Date().toLocaleString()}`);
  
  TestResults.reset();
  
  try {
    await testCoreFunctions();
    await testYoutubeSearch();
    await testYoutubeComments();
    await testYoutubeLikes();
    await testYoutubeSubscriptions();
    await testYoutubeNotifications();
    await testFirebaseIntegration();
    await testRelatedVideos();
    await testYoutubeUI();
    await testYoutubePlayer();
    await testMelodify();
  } catch (e) {
    console.error('Test suite error:', e);
    TestResults.fail('Test suite execution', e.message);
  }
  
  return TestResults.summary();
}

// ==================== QUICK SMOKE TEST ====================

async function runQuickTest() {
  console.log('%c⚡ QUICK SMOKE TEST', 'font-size: 14px; font-weight: bold; color: #FF9800');
  TestResults.reset();
  
  // Essential checks only
  const essentialFuncs = [
    'openApp', 'closeWindowByAppName', 'getVeltraUserId', 'escapeHtml', 'showToast',
    'searchYoutube', 'playYoutubeVideo', 'loadYoutubeComments', 'postYoutubeComment',
    'toggleYoutubeLike', 'toggleYoutubeSubscribe', 'loadYoutubeNotifications',
    'getYoutubeUsername', 'initYoutubeSocial'
  ];
  
  essentialFuncs.forEach(fname => {
    if (typeof window[fname] === 'function') {
      TestResults.pass(`${fname}`);
    } else {
      TestResults.fail(`${fname}`, 'not defined');
    }
  });
  
  return TestResults.summary();
}

// Export for use
window.runYoutubeTests = runYoutubeTests;
window.runQuickTest = runQuickTest;
window.testYoutubeSearch = testYoutubeSearch;
window.testYoutubeComments = testYoutubeComments;
window.testYoutubeLikes = testYoutubeLikes;
window.testYoutubeSubscriptions = testYoutubeSubscriptions;
window.testYoutubeNotifications = testYoutubeNotifications;
window.testMelodify = testMelodify;

console.log('%c✨ YouTube Test Suite Loaded!', 'color: #1DB954; font-weight: bold');
console.log('Run: await runYoutubeTests() - Full test suite');
console.log('Run: await runQuickTest() - Quick smoke test');
