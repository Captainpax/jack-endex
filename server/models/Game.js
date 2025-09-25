import mongoose from '../lib/mongoose.js';

const gameSchema = new mongoose.Schema(
    {
        id: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true, default: 'Untitled Game' },
        dmId: { type: String, required: true, index: true },
    },
    {
        timestamps: true,
        minimize: false,
        strict: false,
    },
);

gameSchema.index({ 'players.userId': 1 });
gameSchema.index({ 'story.channelId': 1 });

export default mongoose.models.Game || mongoose.model('Game', gameSchema);
