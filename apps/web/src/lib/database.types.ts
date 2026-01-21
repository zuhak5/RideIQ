/* eslint-disable */
// Auto-generated from supabase/schema_fresh.sql. Do not edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Enums: {
      driver_status: 'offline' | 'available' | 'on_trip' | 'suspended';
      incident_severity: 'low' | 'medium' | 'high' | 'critical';
      incident_status: 'open' | 'triaging' | 'resolved' | 'closed';
      kyc_status: 'unverified' | 'pending' | 'verified' | 'rejected';
      party_role: 'rider' | 'driver';
      payment_intent_status: 'requires_payment_method' | 'requires_confirmation' | 'requires_capture' | 'succeeded' | 'failed' | 'canceled' | 'refunded';
      payment_provider_kind: 'zaincash' | 'asiapay' | 'qicard' | 'manual';
      ride_actor_type: 'rider' | 'driver' | 'system';
      ride_request_status: 'requested' | 'matched' | 'accepted' | 'cancelled' | 'no_driver' | 'expired';
      ride_status: 'assigned' | 'arrived' | 'in_progress' | 'completed' | 'canceled';
      topup_status: 'created' | 'pending' | 'succeeded' | 'failed';
      wallet_entry_kind: 'topup' | 'ride_fare' | 'withdrawal' | 'adjustment';
      wallet_hold_kind: 'ride' | 'withdraw';
      wallet_hold_status: 'active' | 'captured' | 'released';
      withdraw_payout_kind: 'qicard' | 'asiapay' | 'zaincash';
      withdraw_request_status: 'requested' | 'approved' | 'rejected' | 'paid' | 'cancelled';
    };
    Tables: {
      api_rate_limits: {
        Row: {
          count: number;
          key: string;
          window_seconds: number;
          window_start: string;
        };
        Insert: {
          count?: number;
          key?: string;
          window_seconds?: number;
          window_start?: string;
        };
        Update: {
          count?: number;
          key?: string;
          window_seconds?: number;
          window_start?: string;
        };
        Relationships: [];
      };
      app_events: {
        Row: {
          actor_id: string | null;
          actor_type: string | null;
          created_at: string;
          event_type: string;
          id: string | null;
          level: string;
          payload: Json;
          payment_intent_id: string | null;
          request_id: string | null;
          ride_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          actor_type?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string | null;
          level?: string;
          payload?: Json;
          payment_intent_id?: string | null;
          request_id?: string | null;
          ride_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string | null;
          level?: string;
          payload?: Json;
          payment_intent_id?: string | null;
          request_id?: string | null;
          ride_id?: string | null;
        };
        Relationships: [];
      };
      driver_locations: {
        Row: {
          accuracy_m: number | null;
          driver_id: string | null;
          heading: number | null;
          lat: number;
          lng: number;
          loc: string | null;
          speed_mps: number | null;
          updated_at: string;
        };
        Insert: {
          accuracy_m?: number | null;
          driver_id?: string | null;
          heading?: number | null;
          lat?: number;
          lng?: number;
          loc?: string | null;
          speed_mps?: number | null;
          updated_at?: string;
        };
        Update: {
          accuracy_m?: number | null;
          driver_id?: string | null;
          heading?: number | null;
          lat?: number;
          lng?: number;
          loc?: string | null;
          speed_mps?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      driver_vehicles: {
        Row: {
          color: string | null;
          created_at: string;
          driver_id: string;
          id: string | null;
          make: string | null;
          model: string | null;
          plate_number: string | null;
          updated_at: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          driver_id?: string;
          id?: string | null;
          make?: string | null;
          model?: string | null;
          plate_number?: string | null;
          updated_at?: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          driver_id?: string;
          id?: string | null;
          make?: string | null;
          model?: string | null;
          plate_number?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      drivers: {
        Row: {
          created_at: string;
          id: string | null;
          rating_avg: number;
          rating_count: number;
          status: Database['public']['Enums']['driver_status'];
          trips_count: number;
          updated_at: string;
          vehicle_type: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string | null;
          rating_avg?: number;
          rating_count?: number;
          status?: Database['public']['Enums']['driver_status'];
          trips_count?: number;
          updated_at?: string;
          vehicle_type?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string | null;
          rating_avg?: number;
          rating_count?: number;
          status?: Database['public']['Enums']['driver_status'];
          trips_count?: number;
          updated_at?: string;
          vehicle_type?: string | null;
        };
        Relationships: [];
      };
      payment_intents: {
        Row: {
          amount_iqd: number;
          created_at: string;
          currency: string;
          id: string | null;
          idempotency_key: string | null;
          last_error: string | null;
          metadata: Json;
          provider: string;
          provider_charge_id: string | null;
          provider_payment_intent_id: string | null;
          provider_ref: string | null;
          provider_session_id: string | null;
          ride_id: string;
          status: Database['public']['Enums']['payment_intent_status'];
          updated_at: string;
        };
        Insert: {
          amount_iqd?: number;
          created_at?: string;
          currency?: string;
          id?: string | null;
          idempotency_key?: string | null;
          last_error?: string | null;
          metadata?: Json;
          provider?: string;
          provider_charge_id?: string | null;
          provider_payment_intent_id?: string | null;
          provider_ref?: string | null;
          provider_session_id?: string | null;
          ride_id?: string;
          status?: Database['public']['Enums']['payment_intent_status'];
          updated_at?: string;
        };
        Update: {
          amount_iqd?: number;
          created_at?: string;
          currency?: string;
          id?: string | null;
          idempotency_key?: string | null;
          last_error?: string | null;
          metadata?: Json;
          provider?: string;
          provider_charge_id?: string | null;
          provider_payment_intent_id?: string | null;
          provider_ref?: string | null;
          provider_session_id?: string | null;
          ride_id?: string;
          status?: Database['public']['Enums']['payment_intent_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_providers: {
        Row: {
          code: string | null;
          config: Json;
          created_at: string;
          enabled: boolean;
          kind: Database['public']['Enums']['payment_provider_kind'];
          name: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          code?: string | null;
          config?: Json;
          created_at?: string;
          enabled?: boolean;
          kind?: Database['public']['Enums']['payment_provider_kind'];
          name?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          code?: string | null;
          config?: Json;
          created_at?: string;
          enabled?: boolean;
          kind?: Database['public']['Enums']['payment_provider_kind'];
          name?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          amount_iqd: number;
          created_at: string;
          currency: string;
          failure_code: string | null;
          failure_message: string | null;
          id: string | null;
          metadata: Json;
          method: string | null;
          payment_intent_id: string | null;
          provider: string;
          provider_charge_id: string | null;
          provider_payment_intent_id: string | null;
          provider_ref: string | null;
          provider_refund_id: string | null;
          refund_amount_iqd: number | null;
          refunded_at: string | null;
          ride_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount_iqd?: number;
          created_at?: string;
          currency?: string;
          failure_code?: string | null;
          failure_message?: string | null;
          id?: string | null;
          metadata?: Json;
          method?: string | null;
          payment_intent_id?: string | null;
          provider?: string;
          provider_charge_id?: string | null;
          provider_payment_intent_id?: string | null;
          provider_ref?: string | null;
          provider_refund_id?: string | null;
          refund_amount_iqd?: number | null;
          refunded_at?: string | null;
          ride_id?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount_iqd?: number;
          created_at?: string;
          currency?: string;
          failure_code?: string | null;
          failure_message?: string | null;
          id?: string | null;
          metadata?: Json;
          method?: string | null;
          payment_intent_id?: string | null;
          provider?: string;
          provider_charge_id?: string | null;
          provider_payment_intent_id?: string | null;
          provider_ref?: string | null;
          provider_refund_id?: string | null;
          refund_amount_iqd?: number | null;
          refunded_at?: string | null;
          ride_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pricing_configs: {
        Row: {
          active: boolean;
          base_fare_iqd: number;
          created_at: string;
          currency: string;
          id: string | null;
          minimum_fare_iqd: number;
          per_km_iqd: number;
          per_min_iqd: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          base_fare_iqd?: number;
          created_at?: string;
          currency?: string;
          id?: string | null;
          minimum_fare_iqd?: number;
          per_km_iqd?: number;
          per_min_iqd?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          base_fare_iqd?: number;
          created_at?: string;
          currency?: string;
          id?: string | null;
          minimum_fare_iqd?: number;
          per_km_iqd?: number;
          per_min_iqd?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      profile_kyc: {
        Row: {
          note: string | null;
          status: Database['public']['Enums']['kyc_status'];
          updated_at: string;
          updated_by: string | null;
          user_id: string | null;
        };
        Insert: {
          note?: string | null;
          status?: Database['public']['Enums']['kyc_status'];
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string | null;
        };
        Update: {
          note?: string | null;
          status?: Database['public']['Enums']['kyc_status'];
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string | null;
          is_admin: boolean;
          phone: string | null;
          rating_avg: number;
          rating_count: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id?: string | null;
          is_admin?: boolean;
          phone?: string | null;
          rating_avg?: number;
          rating_count?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string | null;
          is_admin?: boolean;
          phone?: string | null;
          rating_avg?: number;
          rating_count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      provider_events: {
        Row: {
          id: number | null;
          payload: Json;
          provider_code: string;
          provider_event_id: string;
          received_at: string;
        };
        Insert: {
          id?: number | null;
          payload?: Json;
          provider_code?: string;
          provider_event_id?: string;
          received_at?: string;
        };
        Update: {
          id?: number | null;
          payload?: Json;
          provider_code?: string;
          provider_event_id?: string;
          received_at?: string;
        };
        Relationships: [];
      };
      ride_events: {
        Row: {
          actor_id: string | null;
          actor_type: Database['public']['Enums']['ride_actor_type'];
          created_at: string;
          event_type: string;
          id: number | null;
          payload: Json;
          ride_id: string;
        };
        Insert: {
          actor_id?: string | null;
          actor_type?: Database['public']['Enums']['ride_actor_type'];
          created_at?: string;
          event_type?: string;
          id?: number | null;
          payload?: Json;
          ride_id?: string;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: Database['public']['Enums']['ride_actor_type'];
          created_at?: string;
          event_type?: string;
          id?: number | null;
          payload?: Json;
          ride_id?: string;
        };
        Relationships: [];
      };
      ride_incidents: {
        Row: {
          assigned_to: string | null;
          category: string;
          created_at: string;
          description: string | null;
          id: string | null;
          reporter_id: string;
          resolution_note: string | null;
          reviewed_at: string | null;
          ride_id: string;
          severity: Database['public']['Enums']['incident_severity'];
          status: Database['public']['Enums']['incident_status'];
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          category?: string;
          created_at?: string;
          description?: string | null;
          id?: string | null;
          reporter_id?: string;
          resolution_note?: string | null;
          reviewed_at?: string | null;
          ride_id?: string;
          severity?: Database['public']['Enums']['incident_severity'];
          status?: Database['public']['Enums']['incident_status'];
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          category?: string;
          created_at?: string;
          description?: string | null;
          id?: string | null;
          reporter_id?: string;
          resolution_note?: string | null;
          reviewed_at?: string | null;
          ride_id?: string;
          severity?: Database['public']['Enums']['incident_severity'];
          status?: Database['public']['Enums']['incident_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      ride_ratings: {
        Row: {
          comment: string | null;
          created_at: string;
          id: string | null;
          ratee_id: string;
          ratee_role: Database['public']['Enums']['party_role'];
          rater_id: string;
          rater_role: Database['public']['Enums']['party_role'];
          rating: number;
          ride_id: string;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          id?: string | null;
          ratee_id?: string;
          ratee_role?: Database['public']['Enums']['party_role'];
          rater_id?: string;
          rater_role?: Database['public']['Enums']['party_role'];
          rating?: number;
          ride_id?: string;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          id?: string | null;
          ratee_id?: string;
          ratee_role?: Database['public']['Enums']['party_role'];
          rater_id?: string;
          rater_role?: Database['public']['Enums']['party_role'];
          rating?: number;
          ride_id?: string;
        };
        Relationships: [];
      };
      ride_receipts: {
        Row: {
          base_fare_iqd: number | null;
          currency: string;
          generated_at: string;
          receipt_status: string;
          refunded_at: string | null;
          refunded_iqd: number;
          ride_id: string | null;
          tax_iqd: number;
          tip_iqd: number;
          total_iqd: number;
        };
        Insert: {
          base_fare_iqd?: number | null;
          currency?: string;
          generated_at?: string;
          receipt_status?: string;
          refunded_at?: string | null;
          refunded_iqd?: number;
          ride_id?: string | null;
          tax_iqd?: number;
          tip_iqd?: number;
          total_iqd?: number;
        };
        Update: {
          base_fare_iqd?: number | null;
          currency?: string;
          generated_at?: string;
          receipt_status?: string;
          refunded_at?: string | null;
          refunded_iqd?: number;
          ride_id?: string | null;
          tax_iqd?: number;
          tip_iqd?: number;
          total_iqd?: number;
        };
        Relationships: [];
      };
      ride_requests: {
        Row: {
          accepted_at: string | null;
          assigned_driver_id: string | null;
          cancelled_at: string | null;
          created_at: string;
          currency: string;
          dropoff_address: string | null;
          dropoff_lat: number;
          dropoff_lng: number;
          dropoff_loc: string | null;
          id: string | null;
          match_attempts: number;
          match_deadline: string | null;
          matched_at: string | null;
          pickup_address: string | null;
          pickup_lat: number;
          pickup_lng: number;
          pickup_loc: string | null;
          quote_amount_iqd: number | null;
          rider_id: string;
          status: Database['public']['Enums']['ride_request_status'];
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          assigned_driver_id?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          currency?: string;
          dropoff_address?: string | null;
          dropoff_lat?: number;
          dropoff_lng?: number;
          dropoff_loc?: string | null;
          id?: string | null;
          match_attempts?: number;
          match_deadline?: string | null;
          matched_at?: string | null;
          pickup_address?: string | null;
          pickup_lat?: number;
          pickup_lng?: number;
          pickup_loc?: string | null;
          quote_amount_iqd?: number | null;
          rider_id?: string;
          status?: Database['public']['Enums']['ride_request_status'];
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          assigned_driver_id?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          currency?: string;
          dropoff_address?: string | null;
          dropoff_lat?: number;
          dropoff_lng?: number;
          dropoff_loc?: string | null;
          id?: string | null;
          match_attempts?: number;
          match_deadline?: string | null;
          matched_at?: string | null;
          pickup_address?: string | null;
          pickup_lat?: number;
          pickup_lng?: number;
          pickup_loc?: string | null;
          quote_amount_iqd?: number | null;
          rider_id?: string;
          status?: Database['public']['Enums']['ride_request_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      rides: {
        Row: {
          completed_at: string | null;
          created_at: string;
          currency: string;
          driver_id: string;
          fare_amount_iqd: number | null;
          id: string | null;
          paid_at: string | null;
          payment_intent_id: string | null;
          request_id: string;
          rider_id: string;
          started_at: string | null;
          status: Database['public']['Enums']['ride_status'];
          updated_at: string;
          version: number;
          wallet_hold_id: string | null;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          currency?: string;
          driver_id?: string;
          fare_amount_iqd?: number | null;
          id?: string | null;
          paid_at?: string | null;
          payment_intent_id?: string | null;
          request_id?: string;
          rider_id?: string;
          started_at?: string | null;
          status?: Database['public']['Enums']['ride_status'];
          updated_at?: string;
          version?: number;
          wallet_hold_id?: string | null;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          currency?: string;
          driver_id?: string;
          fare_amount_iqd?: number | null;
          id?: string | null;
          paid_at?: string | null;
          payment_intent_id?: string | null;
          request_id?: string;
          rider_id?: string;
          started_at?: string | null;
          status?: Database['public']['Enums']['ride_status'];
          updated_at?: string;
          version?: number;
          wallet_hold_id?: string | null;
        };
        Relationships: [];
      };
      topup_intents: {
        Row: {
          amount_iqd: number;
          bonus_iqd: number;
          completed_at: string | null;
          created_at: string;
          failure_reason: string | null;
          id: string | null;
          idempotency_key: string | null;
          package_id: string | null;
          provider_code: string;
          provider_payload: Json;
          provider_tx_id: string | null;
          status: Database['public']['Enums']['topup_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount_iqd?: number;
          bonus_iqd?: number;
          completed_at?: string | null;
          created_at?: string;
          failure_reason?: string | null;
          id?: string | null;
          idempotency_key?: string | null;
          package_id?: string | null;
          provider_code?: string;
          provider_payload?: Json;
          provider_tx_id?: string | null;
          status?: Database['public']['Enums']['topup_status'];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          amount_iqd?: number;
          bonus_iqd?: number;
          completed_at?: string | null;
          created_at?: string;
          failure_reason?: string | null;
          id?: string | null;
          idempotency_key?: string | null;
          package_id?: string | null;
          provider_code?: string;
          provider_payload?: Json;
          provider_tx_id?: string | null;
          status?: Database['public']['Enums']['topup_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      topup_packages: {
        Row: {
          active: boolean;
          amount_iqd: number;
          bonus_iqd: number;
          created_at: string;
          id: string | null;
          label: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          amount_iqd?: number;
          bonus_iqd?: number;
          created_at?: string;
          id?: string | null;
          label?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          amount_iqd?: number;
          bonus_iqd?: number;
          created_at?: string;
          id?: string | null;
          label?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_notifications: {
        Row: {
          body: string | null;
          created_at: string;
          data: Json;
          id: string | null;
          kind: string;
          read_at: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          data?: Json;
          id?: string | null;
          kind?: string;
          read_at?: string | null;
          title?: string;
          user_id?: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          data?: Json;
          id?: string | null;
          kind?: string;
          read_at?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      wallet_accounts: {
        Row: {
          balance_iqd: number;
          created_at: string;
          held_iqd: number;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          balance_iqd?: number;
          created_at?: string;
          held_iqd?: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          balance_iqd?: number;
          created_at?: string;
          held_iqd?: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      wallet_entries: {
        Row: {
          created_at: string;
          delta_iqd: number;
          id: number | null;
          idempotency_key: string | null;
          kind: Database['public']['Enums']['wallet_entry_kind'];
          memo: string | null;
          metadata: Json;
          source_id: string | null;
          source_type: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          delta_iqd?: number;
          id?: number | null;
          idempotency_key?: string | null;
          kind?: Database['public']['Enums']['wallet_entry_kind'];
          memo?: string | null;
          metadata?: Json;
          source_id?: string | null;
          source_type?: string | null;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          delta_iqd?: number;
          id?: number | null;
          idempotency_key?: string | null;
          kind?: Database['public']['Enums']['wallet_entry_kind'];
          memo?: string | null;
          metadata?: Json;
          source_id?: string | null;
          source_type?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      wallet_holds: {
        Row: {
          amount_iqd: number;
          captured_at: string | null;
          created_at: string;
          id: string | null;
          kind: Database['public']['Enums']['wallet_hold_kind'];
          reason: string | null;
          released_at: string | null;
          ride_id: string | null;
          status: Database['public']['Enums']['wallet_hold_status'];
          updated_at: string;
          user_id: string;
          withdraw_request_id: string | null;
        };
        Insert: {
          amount_iqd?: number;
          captured_at?: string | null;
          created_at?: string;
          id?: string | null;
          kind?: Database['public']['Enums']['wallet_hold_kind'];
          reason?: string | null;
          released_at?: string | null;
          ride_id?: string | null;
          status?: Database['public']['Enums']['wallet_hold_status'];
          updated_at?: string;
          user_id?: string;
          withdraw_request_id?: string | null;
        };
        Update: {
          amount_iqd?: number;
          captured_at?: string | null;
          created_at?: string;
          id?: string | null;
          kind?: Database['public']['Enums']['wallet_hold_kind'];
          reason?: string | null;
          released_at?: string | null;
          ride_id?: string | null;
          status?: Database['public']['Enums']['wallet_hold_status'];
          updated_at?: string;
          user_id?: string;
          withdraw_request_id?: string | null;
        };
        Relationships: [];
      };
      wallet_withdraw_payout_methods: {
        Row: {
          created_at: string;
          enabled: boolean;
          payout_kind: Database['public']['Enums']['withdraw_payout_kind'] | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'] | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'] | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      wallet_withdraw_requests: {
        Row: {
          amount_iqd: number;
          approved_at: string | null;
          cancelled_at: string | null;
          created_at: string;
          destination: Json;
          id: string | null;
          idempotency_key: string | null;
          note: string | null;
          paid_at: string | null;
          payout_kind: Database['public']['Enums']['withdraw_payout_kind'];
          payout_reference: string | null;
          rejected_at: string | null;
          status: Database['public']['Enums']['withdraw_request_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount_iqd?: number;
          approved_at?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          destination?: Json;
          id?: string | null;
          idempotency_key?: string | null;
          note?: string | null;
          paid_at?: string | null;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'];
          payout_reference?: string | null;
          rejected_at?: string | null;
          status?: Database['public']['Enums']['withdraw_request_status'];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          amount_iqd?: number;
          approved_at?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          destination?: Json;
          id?: string | null;
          idempotency_key?: string | null;
          note?: string | null;
          paid_at?: string | null;
          payout_kind?: Database['public']['Enums']['withdraw_payout_kind'];
          payout_reference?: string | null;
          rejected_at?: string | null;
          status?: Database['public']['Enums']['withdraw_request_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      wallet_withdrawal_policy: {
        Row: {
          created_at: string;
          daily_cap_amount_iqd: number;
          daily_cap_count: number;
          id: number | null;
          max_amount_iqd: number;
          min_amount_iqd: number;
          min_trips_count: number;
          require_driver_not_suspended: boolean;
          require_kyc: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          daily_cap_amount_iqd?: number;
          daily_cap_count?: number;
          id?: number | null;
          max_amount_iqd?: number;
          min_amount_iqd?: number;
          min_trips_count?: number;
          require_driver_not_suspended?: boolean;
          require_kyc?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          daily_cap_amount_iqd?: number;
          daily_cap_count?: number;
          id?: number | null;
          max_amount_iqd?: number;
          min_amount_iqd?: number;
          min_trips_count?: number;
          require_driver_not_suspended?: boolean;
          require_kyc?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      admin_record_ride_refund: {
        Args: {
          p_reason: string;
          p_refund_amount_iqd: number;
          p_ride_id: string;
        };
        Returns: Json;
      };
      admin_update_ride_incident: {
        Args: {
          p_assigned_to: string;
          p_incident_id: string;
          p_resolution_note: string;
          p_status: Database['public']['Enums']['incident_status'];
        };
        Returns: undefined;
      };
      admin_wallet_integrity_snapshot: {
        Args: {
          p_hold_age_seconds: number;
          p_limit: number;
          p_topup_age_seconds: number;
        };
        Returns: Json;
      };
      admin_withdraw_approve: {
        Args: {
          p_note: string;
          p_request_id: string;
        };
        Returns: undefined;
      };
      admin_withdraw_mark_paid: {
        Args: {
          p_payout_reference: string;
          p_request_id: string;
        };
        Returns: undefined;
      };
      admin_withdraw_reject: {
        Args: {
          p_note: string;
          p_request_id: string;
        };
        Returns: undefined;
      };
      apply_rating_aggregate: {
        Args: {
        };
        Returns: unknown;
      };
      create_receipt_from_payment: {
        Args: {
        };
        Returns: unknown;
      };
      create_ride_incident: {
        Args: {
          p_category: string;
          p_description: string;
          p_ride_id: string;
          p_severity: Database['public']['Enums']['incident_severity'];
        };
        Returns: string;
      };
      dispatch_accept_ride: {
        Args: {
          p_driver_id: string;
          p_request_id: string;
        };
        Returns: unknown;
      };
      dispatch_match_ride: {
        Args: {
          p_limit_n: number;
          p_match_ttl_seconds: number;
          p_radius_m: number;
          p_request_id: string;
          p_rider_id: string;
          p_stale_after_seconds: number;
        };
        Returns: unknown;
      };
      ensure_wallet_account: {
        Args: {
        };
        Returns: unknown;
      };
      estimate_ride_quote_iqd: {
        Args: {
          _dropoff: string;
          _pickup: string;
        };
        Returns: number;
      };
      handle_new_user: {
        Args: {
        };
        Returns: unknown;
      };
      is_admin: {
        Args: {
        };
        Returns: boolean;
      };
      notify_user: {
        Args: {
          p_body: string;
          p_data: Json;
          p_kind: string;
          p_title: string;
          p_user_id: string;
        };
        Returns: string;
      };
      profile_kyc_init: {
        Args: {
        };
        Returns: unknown;
      };
      rate_limit_consume: {
        Args: {
          p_key: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: unknown;
      };
      ride_requests_clear_match_fields: {
        Args: {
        };
        Returns: unknown;
      };
      ride_requests_release_driver_on_unmatch: {
        Args: {
        };
        Returns: unknown;
      };
      ride_requests_set_quote: {
        Args: {
        };
        Returns: unknown;
      };
      ride_requests_set_status_timestamps: {
        Args: {
        };
        Returns: unknown;
      };
      set_updated_at: {
        Args: {
        };
        Returns: unknown;
      };
      submit_ride_rating: {
        Args: {
          p_comment: string;
          p_rating: number;
          p_ride_id: string;
        };
        Returns: string;
      };
      transition_ride_v2: {
        Args: {
          p_actor_id: string;
          p_actor_type: Database['public']['Enums']['ride_actor_type'];
          p_expected_version: number;
          p_ride_id: string;
          p_to_status: Database['public']['Enums']['ride_status'];
        };
        Returns: unknown;
      };
      try_get_vault_secret: {
        Args: {
          p_name: string;
        };
        Returns: string;
      };
      update_receipt_on_refund: {
        Args: {
        };
        Returns: unknown;
      };
      user_notifications_mark_all_read: {
        Args: {
        };
        Returns: undefined;
      };
      user_notifications_mark_read: {
        Args: {
          p_notification_id: string;
        };
        Returns: undefined;
      };
      wallet_cancel_withdraw: {
        Args: {
          p_request_id: string;
        };
        Returns: undefined;
      };
      wallet_capture_ride_hold: {
        Args: {
          p_ride_id: string;
        };
        Returns: undefined;
      };
      wallet_fail_topup: {
        Args: {
          p_failure_reason: string;
          p_intent_id: string;
          p_provider_payload: Json;
        };
        Returns: unknown;
      };
      wallet_finalize_topup: {
        Args: {
          p_intent_id: string;
          p_provider_payload: Json;
          p_provider_tx_id: string;
        };
        Returns: unknown;
      };
      wallet_get_my_account: {
        Args: {
        };
        Returns: unknown;
      };
      wallet_hold_upsert_for_ride: {
        Args: {
          p_amount_iqd: number;
          p_ride_id: string;
          p_user_id: string;
        };
        Returns: string;
      };
      wallet_release_ride_hold: {
        Args: {
          p_ride_id: string;
        };
        Returns: undefined;
      };
      wallet_request_withdraw: {
        Args: {
          p_amount_iqd: number;
          p_destination: Json;
          p_idempotency_key: string;
          p_payout_kind: Database['public']['Enums']['withdraw_payout_kind'];
        };
        Returns: string;
      };
      wallet_validate_withdraw_destination: {
        Args: {
          p_destination: Json;
          p_payout_kind: Database['public']['Enums']['withdraw_payout_kind'];
        };
        Returns: undefined;
      };
    };
    CompositeTypes: {};
    Views: {};
  };
};
