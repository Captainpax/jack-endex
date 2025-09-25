import mongoose from '../lib/mongoose.js';

const resistanceSchema = new mongoose.Schema(
    {
        weak: { type: [String], default: [] },
        resist: { type: [String], default: [] },
        null: { type: [String], default: [] },
        absorb: { type: [String], default: [] },
        reflect: { type: [String], default: [] },
    },
    { _id: false, minimize: false },
);

const abilitySchema = new mongoose.Schema(
    {
        STR: { type: Number, default: 0 },
        DEX: { type: Number, default: 0 },
        CON: { type: Number, default: 0 },
        INT: { type: Number, default: 0 },
        WIS: { type: Number, default: 0 },
        CHA: { type: Number, default: 0 },
    },
    { _id: false, minimize: false },
);

const demonSchema = new mongoose.Schema(
    {
        slug: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true, index: true },
        arcana: { type: String, default: '' },
        alignment: { type: String, default: '' },
        level: { type: Number, default: 0 },
        description: { type: String, default: '' },
        image: { type: String, default: '' },
        stats: { type: abilitySchema, default: () => ({}) },
        mods: { type: abilitySchema, default: () => ({}) },
        resistances: { type: resistanceSchema, default: () => ({}) },
        skills: { type: [mongoose.Schema.Types.Mixed], default: [] },
        tags: { type: [String], default: [] },
        searchTerms: { type: [String], default: [] },
        sourceId: { type: Number, index: true },
    },
    {
        timestamps: true,
        minimize: false,
    },
);

demonSchema.index({ name: 'text', arcana: 'text', alignment: 'text', description: 'text', searchTerms: 'text' }, {
    weights: { name: 5, arcana: 2, alignment: 2, description: 1, searchTerms: 3 },
});

demonSchema.index({ level: 1 });

demonSchema.pre('save', function normalizeFields(next) {
    if (typeof this.slug === 'string') {
        this.slug = this.slug.trim().toLowerCase();
    }
    if (typeof this.name === 'string') {
        this.name = this.name.trim();
    }
    next();
});

export default mongoose.models.Demon || mongoose.model('Demon', demonSchema);
