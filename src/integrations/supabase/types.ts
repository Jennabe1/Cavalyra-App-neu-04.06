export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      body_scan_history: {
        Row: {
          client_id: string | null
          created_at: string
          deleted: boolean
          deleted_at: string | null
          horse_id: string | null
          id: string
          image_paths: string[]
          image_url: string | null
          result: Json
          scan_date: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          deleted?: boolean
          deleted_at?: string | null
          horse_id?: string | null
          id?: string
          image_paths?: string[]
          image_url?: string | null
          result?: Json
          scan_date?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          deleted?: boolean
          deleted_at?: string | null
          horse_id?: string | null
          id?: string
          image_paths?: string[]
          image_url?: string | null
          result?: Json
          scan_date?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "body_scan_history_horse_id_fkey"
            columns: ["horse_id"]
            isOneToOne: false
            referencedRelation: "horses"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          client_id: string | null
          created_at: string
          data: Json
          deleted: boolean
          deleted_at: string | null
          event_date: string | null
          field_meta: Json
          horse_id: string | null
          id: string
          notes: string | null
          reminder_at: string | null
          title: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          data?: Json
          deleted?: boolean
          deleted_at?: string | null
          event_date?: string | null
          field_meta?: Json
          horse_id?: string | null
          id?: string
          notes?: string | null
          reminder_at?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          data?: Json
          deleted?: boolean
          deleted_at?: string | null
          event_date?: string | null
          field_meta?: Json
          horse_id?: string | null
          id?: string
          notes?: string | null
          reminder_at?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      cloud_backup: {
        Row: {
          created_at: string
          data: Json
          key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      course_progress: {
        Row: {
          completed_at: string | null
          course_id: string
          created_at: string
          data: Json
          deleted_at: string | null
          field_meta: Json
          horse_id: string | null
          id: string
          step: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          completed_at?: string | null
          course_id: string
          created_at?: string
          data?: Json
          deleted_at?: string | null
          field_meta?: Json
          horse_id?: string | null
          id?: string
          step?: number
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          completed_at?: string | null
          course_id?: string
          created_at?: string
          data?: Json
          deleted_at?: string | null
          field_meta?: Json
          horse_id?: string | null
          id?: string
          step?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      horse_journal: {
        Row: {
          client_id: string | null
          content: string | null
          created_at: string
          data: Json
          deleted: boolean
          deleted_at: string | null
          entry_date: string | null
          entry_type: string | null
          field_meta: Json
          horse_id: string | null
          id: string
          title: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          client_id?: string | null
          content?: string | null
          created_at?: string
          data?: Json
          deleted?: boolean
          deleted_at?: string | null
          entry_date?: string | null
          entry_type?: string | null
          field_meta?: Json
          horse_id?: string | null
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          client_id?: string | null
          content?: string | null
          created_at?: string
          data?: Json
          deleted?: boolean
          deleted_at?: string | null
          entry_date?: string | null
          entry_type?: string | null
          field_meta?: Json
          horse_id?: string | null
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "horse_journal_horse_id_fkey"
            columns: ["horse_id"]
            isOneToOne: false
            referencedRelation: "horses"
            referencedColumns: ["id"]
          },
        ]
      }
      horse_members: {
        Row: {
          accepted_at: string | null
          created_at: string
          deleted_at: string | null
          horse_id: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["horse_member_role"]
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          deleted_at?: string | null
          horse_id: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["horse_member_role"]
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          deleted_at?: string | null
          horse_id?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["horse_member_role"]
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      horses: {
        Row: {
          birthdate: string | null
          breed: string | null
          client_id: string | null
          created_at: string
          data: Json
          deleted: boolean
          deleted_at: string | null
          field_meta: Json
          id: string
          name: string | null
          notes: string | null
          photo_path: string | null
          photo_url: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          birthdate?: string | null
          breed?: string | null
          client_id?: string | null
          created_at?: string
          data?: Json
          deleted?: boolean
          deleted_at?: string | null
          field_meta?: Json
          id?: string
          name?: string | null
          notes?: string | null
          photo_path?: string | null
          photo_url?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          birthdate?: string | null
          breed?: string | null
          client_id?: string | null
          created_at?: string
          data?: Json
          deleted?: boolean
          deleted_at?: string | null
          field_meta?: Json
          id?: string
          name?: string | null
          notes?: string | null
          photo_path?: string | null
          photo_url?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      licenses: {
        Row: {
          created_at: string
          customer_id: string | null
          data: Json
          email: string | null
          expires_at: string | null
          id: string
          installation_id: string | null
          source: string
          status: string
          subscription_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          data?: Json
          email?: string | null
          expires_at?: string | null
          id?: string
          installation_id?: string | null
          source: string
          status?: string
          subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          data?: Json
          email?: string | null
          expires_at?: string | null
          id?: string
          installation_id?: string | null
          source?: string
          status?: string
          subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profile_values: {
        Row: {
          created_at: string
          data: Json
          field_meta: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          data?: Json
          field_meta?: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          data?: Json
          field_meta?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      rides: {
        Row: {
          avg_speed: number | null
          client_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          distance_m: number | null
          duration_s: number | null
          ended_at: string | null
          horse_id: string | null
          id: string
          max_speed: number | null
          notes: string | null
          started_at: string | null
          track: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          avg_speed?: number | null
          client_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          distance_m?: number | null
          duration_s?: number | null
          ended_at?: string | null
          horse_id?: string | null
          id?: string
          max_speed?: number | null
          notes?: string | null
          started_at?: string | null
          track?: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          avg_speed?: number | null
          client_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          distance_m?: number | null
          duration_s?: number | null
          ended_at?: string | null
          horse_id?: string | null
          id?: string
          max_speed?: number | null
          notes?: string | null
          started_at?: string | null
          track?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      sync_conflicts: {
        Row: {
          chosen: string
          client_ts: string | null
          client_value: Json | null
          created_at: string
          field: string
          id: string
          row_id: string
          server_ts: string | null
          server_value: Json | null
          table_name: string
          user_id: string
        }
        Insert: {
          chosen: string
          client_ts?: string | null
          client_value?: Json | null
          created_at?: string
          field: string
          id?: string
          row_id: string
          server_ts?: string | null
          server_value?: Json | null
          table_name: string
          user_id: string
        }
        Update: {
          chosen?: string
          client_ts?: string | null
          client_value?: Json | null
          created_at?: string
          field?: string
          id?: string
          row_id?: string
          server_ts?: string | null
          server_value?: Json | null
          table_name?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      sync_upsert_row: {
        Args: { p_base_version: number; p_row: Json; p_table: string }
        Returns: Json
      }
    }
    Enums: {
      horse_member_role: "owner" | "co_rider" | "trainer" | "vet" | "family"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      horse_member_role: ["owner", "co_rider", "trainer", "vet", "family"],
    },
  },
} as const
