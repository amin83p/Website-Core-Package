// MVC/routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireChatAccessAny } = require('../middleware/chatAccessMiddleware');
const { OPERATIONS } = require('../../config/accessConstants');
const upload = require('../middleware/upload'); 

router.use(requireAuth);

router.get('/conversations', requireChatAccessAny([OPERATIONS.READ, OPERATIONS.READ_ALL], OPERATIONS.READ_ALL), chatController.getInbox);
router.get('/messages/:convId', requireChatAccessAny([OPERATIONS.READ, OPERATIONS.READ_ALL], OPERATIONS.READ), chatController.getHistory);
router.get('/attachments/:convId/:fileName', requireChatAccessAny(OPERATIONS.DOWNLOAD_FILE), chatController.downloadAttachment);
router.post('/start', requireChatAccessAny(OPERATIONS.CREATE), chatController.startChat);
router.delete('/delete/:convId', requireChatAccessAny([OPERATIONS.DELETE, OPERATIONS.DELETE_ALL], OPERATIONS.DELETE), chatController.deleteChat);
router.delete('/messages/:convId/:messageId', requireChatAccessAny([OPERATIONS.DELETE, OPERATIONS.DELETE_ALL], OPERATIONS.DELETE), chatController.deleteMessages);
router.post('/messages/bulk-delete', requireChatAccessAny([OPERATIONS.DELETE, OPERATIONS.DELETE_ALL], OPERATIONS.DELETE), chatController.deleteMessages);
router.get('/users/search', requireChatAccessAny(OPERATIONS.CREATE), chatController.searchUsers);
router.get('/broadcast/users/search', requireChatAccessAny(OPERATIONS.DELETE_ALL), chatController.searchBroadcastUsers);

// ✅ UPDATED: upload('chat', true, true)
// Arg 1: 'chat' -> Folder Name
// Arg 2: true   -> Dynamic Subfolders (allows /chat/CONV_123)
// Arg 3: true   -> Force Global (IGNORES user's Org ID)
router.post('/upload', 
            requireChatAccessAny(OPERATIONS.UPDATE),
            upload('chat', true, true).array('files', 5), 
            chatController.uploadAttachment);
router.post('/broadcast/:convId',
            requireChatAccessAny(OPERATIONS.DELETE_ALL),
            upload('chat', true, true).array('files', 5),
            chatController.broadcastMessage);

router.get('/list', requireChatAccessAny(OPERATIONS.READ_ALL), chatController.listAllChats);

module.exports = router;
