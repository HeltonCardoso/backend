// backend/src/routes/sync.routes.js
const express = require('express');
const router = express.Router();
const SyncController = require('../controllers/syncController');

router.get('/status', SyncController.getStatus);
router.post('/prazos', SyncController.sincronizarPrazos);

module.exports = router;