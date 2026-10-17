import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { WORK_TYPES } from '../../lib/classify/workType.ts';


const userSchema = new Schema({
  google_id: { type: String, unique: true, sparse: true },
  email: { type: String, required: true, unique: true },
  // Mirrored from the Google profile on every sign-in (POST /api/user/sync),
  // so a changed name or photo on the Google side is picked up next login.
  email_verified: Boolean,
  name: String,
  given_name: String,
  family_name: String,
  avatar_url: String,
  locale: String,
  last_login_at: Date,
  role: {
    type: String, 
    enum: ['admin', 'client', 'agency'], 
    default: 'client' 
  },
  profile: {
    description: String,
    budget_min: Number,
    // null means "no maximum" — the top stop of the wizard's budget slider.
    budget_max: Number,
    team_size: Number,
    // The skills wizard asks for a band, not a headcount. Kept beside the
    // numeric `team_size` rather than replacing it, so neither loses meaning.
    team_size_band: { type: String, enum: ['solo', 'small', 'medium', 'large', 'xlarge'] },
    duration: { type: String, enum: ['short', 'medium', 'long', 'veryLong'] },
    // How many contracts the team can run at once.
    concurrent: Number,
    // The wizard's first question — what kinds of TOR they are after. Same
    // values as a TOR's `workTypes`, so it can drive the listing's filter.
    work_types: [{ type: String, enum: WORK_TYPES }],
    notify: {
      on_match: Boolean,
      only_strong_fit: Boolean,
      include_signals: Boolean,
    },
    // Set by PUT /api/me/profile. Absent means the user has never saved one.
    updated_at: Date,
    tech_stacks: [{
      //builds the relationship to the TechStack 
      tech_stack_id: { type: Schema.Types.ObjectId, ref: 'TechStack' },
      years_experience: Number
    }]
  },
  created_at: { type: Date, default: Date.now }
});

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export type UserLean = User & { _id: Types.ObjectId };

export type CreateUserInput = Omit<User, "_id" | "__v" | "created_at">;
export type UpdateUserInput = Partial<CreateUserInput>;

export type UserJSON = Omit<User, "__v" | "created_at"> & { id: string };

export const UserModel = model('User', userSchema);