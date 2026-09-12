import { Schema, model, Document, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';


const userSchema = new Schema({
  google_id: { type: String, unique: true, sparse: true },
  email: { type: String, required: true, unique: true },
  role: { 
    type: String, 
    enum: ['admin', 'client', 'agency'], 
    default: 'client' 
  },
  profile: {
    description: String,
    budget_min: Number,
    budget_max: Number,
    team_size: Number,
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