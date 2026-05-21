// MVC/routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { requireChatAccessAny } = require('../middleware/chatAccessMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const upload = require('../middleware/upload'); 

router.use(requireAuth);

router.get('/conversations', requireChatAccessAny([OPERATIONS.READ, OPERATIONS.READ_ALL], OPERATIONS.READ_ALL), chatController.getInbox);
router.get('/messages/:convId', requireChatAccessAny([OPERATIONS.READ, OPERATIONS.READ_ALL], OPERATIONS.READ), chatController.getHistory);
router.post('/start', requireChatAccessAny(OPERATIONS.CREATE), chatController.startChat);
router.delete('/delete/:convId', requireChatAccessAny([OPERATIONS.DELETE, OPERATIONS.DELETE_ALL], OPERATIONS.DELETE), chatController.deleteChat);
router.get('/users/search', requireChatAccessAny(OPERATIONS.CREATE), chatController.searchUsers);

// ✅ UPDATED: upload('chat', true, true)
// Arg 1: 'chat' -> Folder Name
// Arg 2: true   -> Dynamic Subfolders (allows /chat/CONV_123)
// Arg 3: true   -> Force Global (IGNORES user's Org ID)
router.post('/upload', 
            requireChatAccessAny(OPERATIONS.UPDATE),
            upload('chat', true, true).array('files', 5), 
            chatController.uploadAttachment);

router.get('/list', requireAccess(SECTIONS.CHATS, OPERATIONS.READ_ALL), chatController.listAllChats);

module.exports = router;
