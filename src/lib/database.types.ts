export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      agent_actions: {
        Row: {
          auto_assign_at: string | null;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          executed_at: string | null;
          expires_at: string | null;
          id: string;
          payload: Json;
          rationale: string | null;
          requested_by: string;
          status: Database["public"]["Enums"]["action_status"];
          task_id: string | null;
          type: Database["public"]["Enums"]["action_type"];
        };
        Insert: {
          auto_assign_at?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          executed_at?: string | null;
          expires_at?: string | null;
          id?: string;
          payload: Json;
          rationale?: string | null;
          requested_by?: string;
          status?: Database["public"]["Enums"]["action_status"];
          task_id?: string | null;
          type: Database["public"]["Enums"]["action_type"];
        };
        Update: {
          auto_assign_at?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          executed_at?: string | null;
          expires_at?: string | null;
          id?: string;
          payload?: Json;
          rationale?: string | null;
          requested_by?: string;
          status?: Database["public"]["Enums"]["action_status"];
          task_id?: string | null;
          type?: Database["public"]["Enums"]["action_type"];
        };
        Relationships: [
          {
            foreignKeyName: "agent_actions_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_actions_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      availability_windows: {
        Row: {
          ends_at: string;
          id: string;
          parsed_by: string | null;
          raw_text: string | null;
          starts_at: string;
          volunteer_id: string;
        };
        Insert: {
          ends_at: string;
          id?: string;
          parsed_by?: string | null;
          raw_text?: string | null;
          starts_at: string;
          volunteer_id: string;
        };
        Update: {
          ends_at?: string;
          id?: string;
          parsed_by?: string | null;
          raw_text?: string | null;
          starts_at?: string;
          volunteer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "availability_windows_volunteer_id_fkey";
            columns: ["volunteer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      event_timetable: {
        Row: {
          act: string;
          ends_at: string;
          expected_people: number | null;
          id: string;
          stage_id: string;
          starts_at: string;
        };
        Insert: {
          act: string;
          ends_at: string;
          expected_people?: number | null;
          id?: string;
          stage_id: string;
          starts_at: string;
        };
        Update: {
          act?: string;
          ends_at?: string;
          expected_people?: number | null;
          id?: string;
          stage_id?: string;
          starts_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_timetable_stage_id_fkey";
            columns: ["stage_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      guest_requests: {
        Row: {
          ai_answer: string | null;
          created_at: string;
          guest_id: string;
          heard: string;
          id: string;
          location_hint: string | null;
          reopened_at: string | null;
          report_id: string | null;
          stage: Database["public"]["Enums"]["guest_request_stage"];
          task_id: string | null;
          thread: Json;
          updated_at: string;
          voice_clips: string[];
          zone_id: string | null;
        };
        Insert: {
          ai_answer?: string | null;
          created_at?: string;
          guest_id: string;
          heard: string;
          id?: string;
          location_hint?: string | null;
          reopened_at?: string | null;
          report_id?: string | null;
          stage?: Database["public"]["Enums"]["guest_request_stage"];
          task_id?: string | null;
          thread?: Json;
          updated_at?: string;
          voice_clips?: string[];
          zone_id?: string | null;
        };
        Update: {
          ai_answer?: string | null;
          created_at?: string;
          guest_id?: string;
          heard?: string;
          id?: string;
          location_hint?: string | null;
          reopened_at?: string | null;
          report_id?: string | null;
          stage?: Database["public"]["Enums"]["guest_request_stage"];
          task_id?: string | null;
          thread?: Json;
          updated_at?: string;
          voice_clips?: string[];
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "guest_requests_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guest_requests_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guest_requests_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      message_deliveries: {
        Row: {
          audio_path: string | null;
          body_local: string | null;
          delivered_at: string | null;
          delivery: string | null;
          language: string | null;
          message_id: string;
          pushed_at: string | null;
          read_at: string | null;
          recipient_id: string;
        };
        Insert: {
          audio_path?: string | null;
          body_local?: string | null;
          delivered_at?: string | null;
          delivery?: string | null;
          language?: string | null;
          message_id: string;
          pushed_at?: string | null;
          read_at?: string | null;
          recipient_id: string;
        };
        Update: {
          audio_path?: string | null;
          body_local?: string | null;
          delivered_at?: string | null;
          delivery?: string | null;
          language?: string | null;
          message_id?: string;
          pushed_at?: string | null;
          read_at?: string | null;
          recipient_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "message_deliveries_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "message_deliveries_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          action_id: string | null;
          ai_drafted: boolean;
          body: string;
          created_at: string;
          direction: Database["public"]["Enums"]["message_direction"];
          id: string;
          kind: string;
          scope: Database["public"]["Enums"]["message_scope"];
          sender_id: string | null;
          task_id: string | null;
          team_id: string | null;
          zone_id: string | null;
        };
        Insert: {
          action_id?: string | null;
          ai_drafted?: boolean;
          body: string;
          created_at?: string;
          direction?: Database["public"]["Enums"]["message_direction"];
          id?: string;
          kind?: string;
          scope: Database["public"]["Enums"]["message_scope"];
          sender_id?: string | null;
          task_id?: string | null;
          team_id?: string | null;
          zone_id?: string | null;
        };
        Update: {
          action_id?: string | null;
          ai_drafted?: boolean;
          body?: string;
          created_at?: string;
          direction?: Database["public"]["Enums"]["message_direction"];
          id?: string;
          kind?: string;
          scope?: Database["public"]["Enums"]["message_scope"];
          sender_id?: string | null;
          task_id?: string | null;
          team_id?: string | null;
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_action_id_fkey";
            columns: ["action_id"];
            isOneToOne: false;
            referencedRelation: "agent_actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      mobilization_runs: {
        Row: {
          causes: Json;
          created_at: string;
          error: string | null;
          id: string;
          input_snapshot: Json | null;
          mobilization_ids: string[];
          model: string | null;
          playbook: string | null;
          prompt_version: string;
          raw_responses: Json;
          request_id: string;
          requested_by: string | null;
          result: Json | null;
          status: string;
          system_prompt: string;
          updated_at: string;
          user_prompt: string;
          validation_errors: Json;
          zone_slug: string | null;
        };
        Insert: {
          causes?: Json;
          created_at?: string;
          error?: string | null;
          id?: string;
          input_snapshot?: Json | null;
          mobilization_ids?: string[];
          model?: string | null;
          playbook?: string | null;
          prompt_version: string;
          raw_responses?: Json;
          request_id: string;
          requested_by?: string | null;
          result?: Json | null;
          status: string;
          system_prompt?: string;
          updated_at?: string;
          user_prompt?: string;
          validation_errors?: Json;
          zone_slug?: string | null;
        };
        Update: {
          causes?: Json;
          created_at?: string;
          error?: string | null;
          id?: string;
          input_snapshot?: Json | null;
          mobilization_ids?: string[];
          model?: string | null;
          playbook?: string | null;
          prompt_version?: string;
          raw_responses?: Json;
          request_id?: string;
          requested_by?: string | null;
          result?: Json | null;
          status?: string;
          system_prompt?: string;
          updated_at?: string;
          user_prompt?: string;
          validation_errors?: Json;
          zone_slug?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mobilization_runs_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      mobilizations: {
        Row: {
          analysis_run_id: string | null;
          causes: Json;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          evidence: Json | null;
          id: string;
          playbook_slug: string | null;
          rationale: string;
          related_playbooks: string[];
          status: Database["public"]["Enums"]["mobilization_status"];
          steps: Json;
          title: string;
          trigger_playbook: string | null;
          urgency: Database["public"]["Enums"]["priority"];
          zone_id: string | null;
        };
        Insert: {
          analysis_run_id?: string | null;
          causes?: Json;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          evidence?: Json | null;
          id?: string;
          playbook_slug?: string | null;
          rationale: string;
          related_playbooks?: string[];
          status?: Database["public"]["Enums"]["mobilization_status"];
          steps: Json;
          title: string;
          trigger_playbook?: string | null;
          urgency: Database["public"]["Enums"]["priority"];
          zone_id?: string | null;
        };
        Update: {
          analysis_run_id?: string | null;
          causes?: Json;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          evidence?: Json | null;
          id?: string;
          playbook_slug?: string | null;
          rationale?: string;
          related_playbooks?: string[];
          status?: Database["public"]["Enums"]["mobilization_status"];
          steps?: Json;
          title?: string;
          trigger_playbook?: string | null;
          urgency?: Database["public"]["Enums"]["priority"];
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mobilizations_analysis_run_id_fkey";
            columns: ["analysis_run_id"];
            isOneToOne: false;
            referencedRelation: "mobilization_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mobilizations_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mobilizations_playbook_slug_fkey";
            columns: ["playbook_slug"];
            isOneToOne: false;
            referencedRelation: "playbooks";
            referencedColumns: ["slug"];
          },
          {
            foreignKeyName: "mobilizations_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      playbooks: {
        Row: {
          created_by: string | null;
          id: string;
          slug: string;
          steps: Json;
          title: string;
          trigger: string;
        };
        Insert: {
          created_by?: string | null;
          id?: string;
          slug: string;
          steps: Json;
          title: string;
          trigger: string;
        };
        Update: {
          created_by?: string | null;
          id?: string;
          slug?: string;
          steps?: Json;
          title?: string;
          trigger?: string;
        };
        Relationships: [
          {
            foreignKeyName: "playbooks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      presence: {
        Row: {
          accuracy: number | null;
          at: string;
          heading: number | null;
          lat: number;
          lng: number;
          person_id: string;
        };
        Insert: {
          accuracy?: number | null;
          at?: string;
          heading?: number | null;
          lat: number;
          lng: number;
          person_id?: string;
        };
        Update: {
          accuracy?: number | null;
          at?: string;
          heading?: number | null;
          lat?: number;
          lng?: number;
          person_id?: string;
        };
        Relationships: [];
      };
      profile_private: {
        Row: {
          bio: string | null;
          id: string;
          phone: string | null;
          push_token: string | null;
        };
        Insert: {
          bio?: string | null;
          id: string;
          phone?: string | null;
          push_token?: string | null;
        };
        Update: {
          bio?: string | null;
          id?: string;
          phone?: string | null;
          push_token?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profile_private_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          experience: string | null;
          full_name: string;
          id: string;
          languages: string[];
          last_known_zone: string | null;
          last_seen_at: string | null;
          role: Database["public"]["Enums"]["user_role"];
          status: Database["public"]["Enums"]["volunteer_status"];
          team_id: string | null;
        };
        Insert: {
          created_at?: string;
          experience?: string | null;
          full_name: string;
          id: string;
          languages?: string[];
          last_known_zone?: string | null;
          last_seen_at?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["volunteer_status"];
          team_id?: string | null;
        };
        Update: {
          created_at?: string;
          experience?: string | null;
          full_name?: string;
          id?: string;
          languages?: string[];
          last_known_zone?: string | null;
          last_seen_at?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["volunteer_status"];
          team_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_last_known_zone_fkey";
            columns: ["last_known_zone"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      push_tokens: {
        Row: {
          person_id: string;
          platform: string | null;
          token: string;
          updated_at: string;
        };
        Insert: {
          person_id: string;
          platform?: string | null;
          token: string;
          updated_at?: string;
        };
        Update: {
          person_id?: string;
          platform?: string | null;
          token?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      readings: {
        Row: {
          created_at: string;
          id: string;
          key: string;
          observed_at: string;
          source: string;
          value: Json;
          zone_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          key: string;
          observed_at?: string;
          source: string;
          value: Json;
          zone_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          key?: string;
          observed_at?: string;
          source?: string;
          value?: Json;
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "readings_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      reports: {
        Row: {
          channel: Database["public"]["Enums"]["report_channel"];
          detected_language: string | null;
          first_aid_needed: boolean | null;
          id: string;
          lat: number | null;
          lng: number | null;
          location_hint: string | null;
          media_url: string | null;
          playbook: string | null;
          playbook_sure: boolean | null;
          raw_text: string | null;
          received_at: string;
          reporter_contact: string | null;
          reporter_id: string | null;
          reporter_kind: Database["public"]["Enums"]["reporter_kind"];
          speaker_needed: string | null;
          text_en: string | null;
          voice_clips: string[];
          zone_id: string | null;
        };
        Insert: {
          channel: Database["public"]["Enums"]["report_channel"];
          detected_language?: string | null;
          first_aid_needed?: boolean | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          location_hint?: string | null;
          media_url?: string | null;
          playbook?: string | null;
          playbook_sure?: boolean | null;
          raw_text?: string | null;
          received_at?: string;
          reporter_contact?: string | null;
          reporter_id?: string | null;
          reporter_kind?: Database["public"]["Enums"]["reporter_kind"];
          speaker_needed?: string | null;
          text_en?: string | null;
          voice_clips?: string[];
          zone_id?: string | null;
        };
        Update: {
          channel?: Database["public"]["Enums"]["report_channel"];
          detected_language?: string | null;
          first_aid_needed?: boolean | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          location_hint?: string | null;
          media_url?: string | null;
          playbook?: string | null;
          playbook_sure?: boolean | null;
          raw_text?: string | null;
          received_at?: string;
          reporter_contact?: string | null;
          reporter_id?: string | null;
          reporter_kind?: Database["public"]["Enums"]["reporter_kind"];
          speaker_needed?: string | null;
          text_en?: string | null;
          voice_clips?: string[];
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      shift_assignments: {
        Row: {
          checked_in_at: string | null;
          created_at: string;
          id: string;
          reminded_at: string | null;
          replaced_by: string | null;
          shift_id: string;
          status: Database["public"]["Enums"]["shift_assignment_status"];
          volunteer_id: string;
        };
        Insert: {
          checked_in_at?: string | null;
          created_at?: string;
          id?: string;
          reminded_at?: string | null;
          replaced_by?: string | null;
          shift_id: string;
          status?: Database["public"]["Enums"]["shift_assignment_status"];
          volunteer_id: string;
        };
        Update: {
          checked_in_at?: string | null;
          created_at?: string;
          id?: string;
          reminded_at?: string | null;
          replaced_by?: string | null;
          shift_id?: string;
          status?: Database["public"]["Enums"]["shift_assignment_status"];
          volunteer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shift_assignments_replaced_by_fkey";
            columns: ["replaced_by"];
            isOneToOne: false;
            referencedRelation: "shift_assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_assignments_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "shifts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_assignments_volunteer_id_fkey";
            columns: ["volunteer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      shifts: {
        Row: {
          ends_at: string;
          id: string;
          notes: string | null;
          required_count: number;
          required_skill_ids: string[];
          starts_at: string;
          team_id: string;
          zone_id: string | null;
        };
        Insert: {
          ends_at: string;
          id?: string;
          notes?: string | null;
          required_count?: number;
          required_skill_ids?: string[];
          starts_at: string;
          team_id: string;
          zone_id?: string | null;
        };
        Update: {
          ends_at?: string;
          id?: string;
          notes?: string | null;
          required_count?: number;
          required_skill_ids?: string[];
          starts_at?: string;
          team_id?: string;
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "shifts_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shifts_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      skills: {
        Row: {
          id: string;
          name: string;
          requires_expiry: boolean;
          slug: string;
        };
        Insert: {
          id?: string;
          name: string;
          requires_expiry?: boolean;
          slug: string;
        };
        Update: {
          id?: string;
          name?: string;
          requires_expiry?: boolean;
          slug?: string;
        };
        Relationships: [];
      };
      task_assignments: {
        Row: {
          approved_by: string | null;
          created_at: string;
          distance_m: number | null;
          id: string;
          proposed_by: string;
          rationale: string | null;
          status: Database["public"]["Enums"]["task_assignment_status"];
          task_id: string;
          updated_at: string;
          volunteer_id: string;
        };
        Insert: {
          approved_by?: string | null;
          created_at?: string;
          distance_m?: number | null;
          id?: string;
          proposed_by?: string;
          rationale?: string | null;
          status?: Database["public"]["Enums"]["task_assignment_status"];
          task_id: string;
          updated_at?: string;
          volunteer_id: string;
        };
        Update: {
          approved_by?: string | null;
          created_at?: string;
          distance_m?: number | null;
          id?: string;
          proposed_by?: string;
          rationale?: string | null;
          status?: Database["public"]["Enums"]["task_assignment_status"];
          task_id?: string;
          updated_at?: string;
          volunteer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_assignments_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_assignments_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_assignments_volunteer_id_fkey";
            columns: ["volunteer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      task_events: {
        Row: {
          actor_id: string | null;
          actor_kind: string;
          created_at: string;
          data: Json;
          id: string;
          kind: string;
          task_id: string;
        };
        Insert: {
          actor_id?: string | null;
          actor_kind?: string;
          created_at?: string;
          data?: Json;
          id?: string;
          kind: string;
          task_id: string;
        };
        Update: {
          actor_id?: string | null;
          actor_kind?: string;
          created_at?: string;
          data?: Json;
          id?: string;
          kind?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_events_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          ai_response: string | null;
          assigned_at: string | null;
          assignee_id: string | null;
          category: Database["public"]["Enums"]["incident_category"];
          created_at: string;
          declined_ids: string[];
          escalation: Json | null;
          eta_at: string | null;
          handled_by: Database["public"]["Enums"]["handled_by"];
          helper_ids: string[];
          helper_status: Json;
          id: string;
          last_activity_at: string;
          last_nudge_at: string | null;
          lead_alerted_at: string | null;
          location_hint: string | null;
          mobilization_id: string | null;
          mobilization_step_key: string | null;
          needs_human_review: boolean;
          nudge_count: number;
          priority: Database["public"]["Enums"]["priority"];
          report_id: string;
          request_id: string | null;
          required_count: number;
          required_skills: string[];
          resolution: Database["public"]["Enums"]["task_resolution"] | null;
          resolved_at: string | null;
          resolved_by: string | null;
          response_lang: string | null;
          status: Database["public"]["Enums"]["task_status"];
          summary: string;
          team_id: string | null;
          title: string;
          triage_run_id: string | null;
          updated_at: string;
          zone_id: string | null;
        };
        Insert: {
          ai_response?: string | null;
          assigned_at?: string | null;
          assignee_id?: string | null;
          category: Database["public"]["Enums"]["incident_category"];
          created_at?: string;
          declined_ids?: string[];
          escalation?: Json | null;
          eta_at?: string | null;
          handled_by: Database["public"]["Enums"]["handled_by"];
          helper_ids?: string[];
          helper_status?: Json;
          id?: string;
          last_activity_at?: string;
          last_nudge_at?: string | null;
          lead_alerted_at?: string | null;
          location_hint?: string | null;
          mobilization_id?: string | null;
          mobilization_step_key?: string | null;
          needs_human_review?: boolean;
          nudge_count?: number;
          priority: Database["public"]["Enums"]["priority"];
          report_id: string;
          request_id?: string | null;
          required_count?: number;
          required_skills?: string[];
          resolution?: Database["public"]["Enums"]["task_resolution"] | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          response_lang?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          summary: string;
          team_id?: string | null;
          title: string;
          triage_run_id?: string | null;
          updated_at?: string;
          zone_id?: string | null;
        };
        Update: {
          ai_response?: string | null;
          assigned_at?: string | null;
          assignee_id?: string | null;
          category?: Database["public"]["Enums"]["incident_category"];
          created_at?: string;
          declined_ids?: string[];
          escalation?: Json | null;
          eta_at?: string | null;
          handled_by?: Database["public"]["Enums"]["handled_by"];
          helper_ids?: string[];
          helper_status?: Json;
          id?: string;
          last_activity_at?: string;
          last_nudge_at?: string | null;
          lead_alerted_at?: string | null;
          location_hint?: string | null;
          mobilization_id?: string | null;
          mobilization_step_key?: string | null;
          needs_human_review?: boolean;
          nudge_count?: number;
          priority?: Database["public"]["Enums"]["priority"];
          report_id?: string;
          request_id?: string | null;
          required_count?: number;
          required_skills?: string[];
          resolution?: Database["public"]["Enums"]["task_resolution"] | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          response_lang?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          summary?: string;
          team_id?: string | null;
          title?: string;
          triage_run_id?: string | null;
          updated_at?: string;
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_mobilization_id_fkey";
            columns: ["mobilization_id"];
            isOneToOne: false;
            referencedRelation: "mobilizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "guest_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_triage_run_id_fkey";
            columns: ["triage_run_id"];
            isOneToOne: false;
            referencedRelation: "triage_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      teams: {
        Row: {
          color: string | null;
          created_at: string;
          description: string;
          handles: Database["public"]["Enums"]["incident_category"][];
          id: string;
          name: string;
          slug: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          description: string;
          handles?: Database["public"]["Enums"]["incident_category"][];
          id?: string;
          name: string;
          slug: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          description?: string;
          handles?: Database["public"]["Enums"]["incident_category"][];
          id?: string;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      triage_runs: {
        Row: {
          assignment_result: Json | null;
          created_at: string;
          error: string | null;
          id: string;
          latency_ms: number | null;
          models: Json | null;
          priority_result: Json | null;
          report_id: string | null;
          request_id: string | null;
          rewrite_result: Json | null;
          route: Database["public"]["Enums"]["route_decision"];
          route_reason: string | null;
          router_conf: number | null;
          team_result: Json | null;
        };
        Insert: {
          assignment_result?: Json | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          latency_ms?: number | null;
          models?: Json | null;
          priority_result?: Json | null;
          report_id?: string | null;
          request_id?: string | null;
          rewrite_result?: Json | null;
          route: Database["public"]["Enums"]["route_decision"];
          route_reason?: string | null;
          router_conf?: number | null;
          team_result?: Json | null;
        };
        Update: {
          assignment_result?: Json | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          latency_ms?: number | null;
          models?: Json | null;
          priority_result?: Json | null;
          report_id?: string | null;
          request_id?: string | null;
          rewrite_result?: Json | null;
          route?: Database["public"]["Enums"]["route_decision"];
          route_reason?: string | null;
          router_conf?: number | null;
          team_result?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "triage_runs_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "triage_runs_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "guest_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      trigger_checks: {
        Row: {
          checked_at: string;
          id: string;
          playbook: string | null;
          task_ids: string[];
          zone_slug: string;
        };
        Insert: {
          checked_at?: string;
          id?: string;
          playbook?: string | null;
          task_ids: string[];
          zone_slug: string;
        };
        Update: {
          checked_at?: string;
          id?: string;
          playbook?: string | null;
          task_ids?: string[];
          zone_slug?: string;
        };
        Relationships: [];
      };
      volunteer_skills: {
        Row: {
          expires_on: string | null;
          skill_id: string;
          verified_by: string | null;
          volunteer_id: string;
        };
        Insert: {
          expires_on?: string | null;
          skill_id: string;
          verified_by?: string | null;
          volunteer_id: string;
        };
        Update: {
          expires_on?: string | null;
          skill_id?: string;
          verified_by?: string | null;
          volunteer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "volunteer_skills_skill_id_fkey";
            columns: ["skill_id"];
            isOneToOne: false;
            referencedRelation: "skills";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "volunteer_skills_verified_by_fkey";
            columns: ["verified_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "volunteer_skills_volunteer_id_fkey";
            columns: ["volunteer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      zones: {
        Row: {
          capacity: number | null;
          created_at: string;
          id: string;
          is_open_air: boolean;
          kind: string;
          lat: number | null;
          lng: number | null;
          name: string;
          slug: string;
        };
        Insert: {
          capacity?: number | null;
          created_at?: string;
          id?: string;
          is_open_air?: boolean;
          kind?: string;
          lat?: number | null;
          lng?: number | null;
          name: string;
          slug: string;
        };
        Update: {
          capacity?: number | null;
          created_at?: string;
          id?: string;
          is_open_air?: boolean;
          kind?: string;
          lat?: number | null;
          lng?: number | null;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      action_status: "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";
      action_type:
        | "assign_volunteer"
        | "broadcast_message"
        | "move_team"
        | "draft_incident_report"
        | "request_shift_cover"
        | "escalate_emergency_services";
      guest_request_stage:
        | "understanding"
        | "answered"
        | "finding"
        | "coming"
        | "with_you"
        | "sorted"
        | "cancelled";
      handled_by: "ai" | "human";
      incident_category:
        | "medical"
        | "heat"
        | "lost_child"
        | "lost_property"
        | "crowding"
        | "security"
        | "weather"
        | "facilities"
        | "accessibility"
        | "info_request"
        | "artist"
        | "vendor"
        | "technical"
        | "other";
      message_direction: "outbound" | "inbound";
      message_scope: "direct" | "team" | "zone" | "broadcast";
      mobilization_status: "proposed" | "active" | "stood_down" | "cancelled" | "rejected";
      priority: "P1" | "P2" | "P3";
      report_channel: "text" | "voice" | "radio" | "photo" | "phone" | "in_person";
      reporter_kind: "festivalgoer" | "volunteer" | "staff" | "system";
      route_decision: "ai_resolved" | "escalated_to_triage";
      shift_assignment_status:
        | "assigned"
        | "confirmed"
        | "checked_in"
        | "on_break"
        | "completed"
        | "no_show"
        | "swapped_out"
        | "released";
      task_assignment_status:
        | "proposed"
        | "approved"
        | "rejected"
        | "notified"
        | "accepted"
        | "declined"
        | "en_route"
        | "on_scene"
        | "done"
        | "reassigned";
      task_resolution: "done" | "handed_over" | "cancelled";
      task_status:
        | "open"
        | "queued"
        | "assigned"
        | "accepted"
        | "in_progress"
        | "escalated"
        | "resolved"
        | "cancelled";
      user_role: "volunteer" | "team_lead" | "coordinator" | "safety_lead" | "admin";
      volunteer_status: "invited" | "active" | "on_break" | "off_shift" | "unavailable";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      action_status: ["pending", "approved", "rejected", "executed", "failed", "expired"],
      action_type: [
        "assign_volunteer",
        "broadcast_message",
        "move_team",
        "draft_incident_report",
        "request_shift_cover",
        "escalate_emergency_services",
      ],
      guest_request_stage: [
        "understanding",
        "answered",
        "finding",
        "coming",
        "with_you",
        "sorted",
        "cancelled",
      ],
      handled_by: ["ai", "human"],
      incident_category: [
        "medical",
        "heat",
        "lost_child",
        "lost_property",
        "crowding",
        "security",
        "weather",
        "facilities",
        "accessibility",
        "info_request",
        "artist",
        "vendor",
        "technical",
        "other",
      ],
      message_direction: ["outbound", "inbound"],
      message_scope: ["direct", "team", "zone", "broadcast"],
      mobilization_status: ["proposed", "active", "stood_down", "cancelled", "rejected"],
      priority: ["P1", "P2", "P3"],
      report_channel: ["text", "voice", "radio", "photo", "phone", "in_person"],
      reporter_kind: ["festivalgoer", "volunteer", "staff", "system"],
      route_decision: ["ai_resolved", "escalated_to_triage"],
      shift_assignment_status: [
        "assigned",
        "confirmed",
        "checked_in",
        "on_break",
        "completed",
        "no_show",
        "swapped_out",
        "released",
      ],
      task_assignment_status: [
        "proposed",
        "approved",
        "rejected",
        "notified",
        "accepted",
        "declined",
        "en_route",
        "on_scene",
        "done",
        "reassigned",
      ],
      task_resolution: ["done", "handed_over", "cancelled"],
      task_status: [
        "open",
        "queued",
        "assigned",
        "accepted",
        "in_progress",
        "escalated",
        "resolved",
        "cancelled",
      ],
      user_role: ["volunteer", "team_lead", "coordinator", "safety_lead", "admin"],
      volunteer_status: ["invited", "active", "on_break", "off_shift", "unavailable"],
    },
  },
} as const;
