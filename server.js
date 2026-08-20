const express = require('express');
const path = require('path');
const app = express();
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LM4 static server listening on ${PORT}`));
