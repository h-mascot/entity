CREATE TABLE file_sources (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT,
      base_path TEXT,
      auth_type TEXT NOT NULL DEFAULT 'none',
      auth_ref TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      capabilities TEXT NOT NULL DEFAULT '{}',
      health TEXT NOT NULL DEFAULT 'ok',
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_file_sources_enabled ON file_sources(enabled);
CREATE INDEX idx_file_sources_type ON file_sources(type);
CREATE INDEX idx_file_sources_updated_at ON file_sources(updated_at DESC);
CREATE TABLE file_index (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'one-off',
      agent TEXT NOT NULL DEFAULT 'other',
      is_recurring INTEGER NOT NULL DEFAULT 0,
      recurring_pattern TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      preview TEXT,
      content_hash TEXT
    , origin TEXT NOT NULL DEFAULT 'unknown', org_id TEXT, sensitivity TEXT, acl_json TEXT, entity_visibility_policy_json TEXT);
CREATE UNIQUE INDEX idx_file_index_source_path ON file_index(source_id, path);
CREATE INDEX idx_file_index_source ON file_index(source_id);
CREATE INDEX idx_file_index_type ON file_index(type);
CREATE INDEX idx_file_index_agent ON file_index(agent);
CREATE INDEX idx_file_index_indexed_at ON file_index(indexed_at DESC);
CREATE TABLE file_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      error TEXT,
      files_scanned INTEGER NOT NULL DEFAULT 0,
      files_indexed INTEGER NOT NULL DEFAULT 0
    );
CREATE INDEX idx_file_sync_runs_source ON file_sync_runs(source_id);
CREATE INDEX idx_file_sync_runs_status ON file_sync_runs(status);
CREATE INDEX idx_file_sync_runs_started_at ON file_sync_runs(started_at DESC);
CREATE INDEX idx_file_index_origin ON file_index(origin);
CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      column TEXT NOT NULL DEFAULT 'backlog',
      assignee TEXT DEFAULT 'Unassigned',
      blocked INTEGER NOT NULL DEFAULT 0,
      blocker_reason TEXT,
      project TEXT DEFAULT 'General',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT
    , brief TEXT, origin_channel TEXT, due_date TEXT, priority TEXT DEFAULT 'P2', estimate_hours REAL, time_spent REAL DEFAULT 0, output TEXT, progress_status TEXT DEFAULT 'backlog', recurring INTEGER DEFAULT 0, recurring_config TEXT, model TEXT, archived INTEGER DEFAULT 0, org_id TEXT DEFAULT 'default-org', team_id TEXT DEFAULT 'default-team', project_id INTEGER, created_by_principal_id TEXT DEFAULT 'legacy-system', initiator_principal_id TEXT DEFAULT 'legacy-unknown', initiator_type TEXT DEFAULT 'unknown', owner_principal_id TEXT DEFAULT 'legacy-owner', owner_principal_type TEXT DEFAULT 'unknown', executor_principal_id TEXT, assignment_state TEXT DEFAULT 'unassigned', taskmaster_drivable INTEGER NOT NULL DEFAULT 0, worktype TEXT NOT NULL DEFAULT 'general', risk_level TEXT NOT NULL DEFAULT 'low', agent_trust_level TEXT NOT NULL DEFAULT 'unknown', policy_inputs_json TEXT NOT NULL DEFAULT '{}', external_side_effects_json TEXT NOT NULL DEFAULT '[]', review_required INTEGER NOT NULL DEFAULT 0, review_state TEXT NOT NULL DEFAULT 'not_required', human_gate_required INTEGER NOT NULL DEFAULT 0, human_gate_state TEXT NOT NULL DEFAULT 'not_required');
CREATE INDEX idx_tasks_column ON tasks(column);
CREATE INDEX idx_tasks_updated_at ON tasks(updated_at DESC);
CREATE TABLE activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'agent',
      type TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      agent_name TEXT,
      agent_emoji TEXT,
      file_path TEXT,
      task_id INTEGER,
      task_column TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , activity_event_type TEXT, activity_event_payload_version INTEGER NOT NULL DEFAULT 1, activity_event_payload_json TEXT, activity_event_schema_status TEXT NOT NULL DEFAULT 'legacy_mapped', activity_event_legacy_type TEXT);
CREATE INDEX idx_activities_created_at ON activities(created_at DESC, id DESC);
CREATE INDEX idx_activities_source ON activities(source);
CREATE INDEX idx_activities_task_id ON activities(task_id);
CREATE INDEX idx_activities_file_path ON activities(file_path);
CREATE TABLE agent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      event TEXT NOT NULL,
      task_id INTEGER,
      action TEXT NOT NULL,
      result TEXT,
      model TEXT DEFAULT 'gemini-flash',
      tokens_used INTEGER DEFAULT 0
    );
CREATE INDEX idx_agent_log_timestamp ON agent_log(timestamp DESC, id DESC);
CREATE INDEX idx_agent_log_event ON agent_log(event);
CREATE INDEX idx_agent_log_task_id ON agent_log(task_id);
CREATE TABLE task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      author TEXT DEFAULT 'Human',
      parent_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE roadmaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      theme TEXT,
      color TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE roadmap_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roadmap_id INTEGER NOT NULL REFERENCES roadmaps(id),
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'P2',
      target_period TEXT,
      status TEXT DEFAULT 'planned',
      linked_task_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_roadmap_items_roadmap_id ON roadmap_items(roadmap_id);
CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , org_id TEXT DEFAULT 'default-org', team_id TEXT DEFAULT 'default-team', lifecycle_state TEXT DEFAULT 'active');
CREATE TABLE subscriptions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES entity_agents(id) ON DELETE CASCADE,
      crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, crew_id)
    );
CREATE TABLE crews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      settings TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_crews_updated_at ON crews(updated_at DESC, id DESC);
CREATE TABLE crew_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(crew_id, agent_id)
    );
CREATE INDEX idx_crew_subscriptions_crew ON crew_subscriptions(crew_id);
CREATE INDEX idx_crew_subscriptions_agent ON crew_subscriptions(agent_id);
CREATE TABLE task_projects (
      task_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL, org_id TEXT DEFAULT 'default-org',
      PRIMARY KEY (task_id, project_id)
    );
CREATE INDEX idx_task_projects_task_id ON task_projects(task_id);
CREATE INDEX idx_task_projects_project_id ON task_projects(project_id);
CREATE TABLE task_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_by TEXT,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_task_history_task_id ON task_history(task_id);
CREATE INDEX idx_task_history_changed_at ON task_history(changed_at DESC, id DESC);
CREATE TABLE document_sessions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content_hash TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_document_sessions_doc_id ON document_sessions(doc_id);
CREATE INDEX idx_document_sessions_updated_at ON document_sessions(updated_at DESC);
CREATE TABLE document_authorship_ranges (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      author TEXT NOT NULL,
      reviewed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_document_authorship_ranges_doc_id ON document_authorship_ranges(doc_id);
CREATE INDEX idx_document_authorship_ranges_updated_at ON document_authorship_ranges(updated_at DESC);
CREATE TABLE document_authorship_history (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      range_id TEXT,
      author TEXT NOT NULL,
      diff_json TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_document_authorship_history_doc_id ON document_authorship_history(doc_id);
CREATE INDEX idx_document_authorship_history_updated_at ON document_authorship_history(updated_at DESC);
CREATE TABLE document_presence (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      cursor_json TEXT NOT NULL DEFAULT '{}',
      last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE UNIQUE INDEX idx_document_presence_doc_agent ON document_presence(doc_id, agent_id);
CREATE INDEX idx_document_presence_doc_id ON document_presence(doc_id);
CREATE INDEX idx_document_presence_updated_at ON document_presence(updated_at DESC);
CREATE TABLE document_comments (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      selected_text TEXT,
      text TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_document_comments_doc_id ON document_comments(doc_id);
CREATE INDEX idx_document_comments_updated_at ON document_comments(updated_at DESC);
CREATE TABLE document_comment_replies (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      comment_id TEXT NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_document_comment_replies_doc_id ON document_comment_replies(doc_id);
CREATE INDEX idx_document_comment_replies_comment_id ON document_comment_replies(comment_id);
CREATE INDEX idx_document_comment_replies_updated_at ON document_comment_replies(updated_at DESC);
CREATE TABLE document_suggestions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      original_text TEXT NOT NULL,
      suggested_text TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_document_suggestions_doc_id ON document_suggestions(doc_id);
CREATE INDEX idx_document_suggestions_updated_at ON document_suggestions(updated_at DESC);
CREATE TABLE document_review_runs (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_document_review_runs_doc_id ON document_review_runs(doc_id);
CREATE INDEX idx_document_review_runs_updated_at ON document_review_runs(updated_at DESC);
CREATE TABLE agent_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      token_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE UNIQUE INDEX idx_agent_tokens_hash ON agent_tokens(token_hash);
CREATE UNIQUE INDEX idx_agent_tokens_type_actor ON agent_tokens(token_type, actor);
CREATE INDEX idx_agent_tokens_updated_at ON agent_tokens(updated_at DESC);
CREATE TABLE entity_agents (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      avatar_url TEXT,
      description TEXT,
      adapter_type TEXT,
      runtime_type TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      instructions_path TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , runtime_binding_id TEXT, provider_type TEXT NOT NULL DEFAULT 'unknown', helm_managed INTEGER NOT NULL DEFAULT 0, binding_state TEXT NOT NULL DEFAULT 'unknown');
CREATE TABLE entity_modules (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      kind TEXT NOT NULL DEFAULT 'core',
      permissions_schema_json TEXT NOT NULL DEFAULT '[]',
      ui_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE entity_agent_module_grants (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      permissions_json TEXT NOT NULL DEFAULT '[]',
      scope_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, module_id)
    );
CREATE TABLE entity_module_skill_refs (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );
CREATE INDEX idx_entity_agents_slug ON entity_agents(slug);
CREATE INDEX idx_entity_agents_status ON entity_agents(status);
CREATE INDEX idx_entity_modules_slug ON entity_modules(slug);
CREATE INDEX idx_entity_grants_agent ON entity_agent_module_grants(agent_id);
CREATE INDEX idx_entity_grants_module ON entity_agent_module_grants(module_id);
CREATE INDEX idx_entity_skill_refs_module ON entity_module_skill_refs(module_id);
CREATE TABLE swarm_jobs (
      id            TEXT PRIMARY KEY,
      task_id       INTEGER,
      title         TEXT NOT NULL,
      spec          TEXT NOT NULL,
      repo          TEXT NOT NULL,
      branch        TEXT,
      provider      TEXT NOT NULL DEFAULT 'acp',
      status        TEXT NOT NULL DEFAULT 'draft',
      priority      TEXT NOT NULL DEFAULT 'medium',
      context_file  TEXT,
      run_handle    TEXT,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      max_retries   INTEGER NOT NULL DEFAULT 3,
      feedback      TEXT,
      created_by    TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      dispatched_at TEXT,
      completed_at  TEXT
    );
CREATE INDEX idx_swarm_jobs_status ON swarm_jobs(status);
CREATE INDEX idx_swarm_jobs_task   ON swarm_jobs(task_id);
CREATE TABLE swarm_proofs (
      id            TEXT PRIMARY KEY,
      job_id        TEXT NOT NULL REFERENCES swarm_jobs(id),
      provider      TEXT NOT NULL,
      commit_sha    TEXT,
      branch        TEXT,
      build_log     TEXT,
      test_result   TEXT,
      test_output   TEXT,
      screenshots   TEXT,
      artifacts     TEXT,
      duration_sec  INTEGER,
      proof_type    TEXT NOT NULL DEFAULT 'artifact',
      proof_ref     TEXT NOT NULL DEFAULT 'proof',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
CREATE INDEX idx_swarm_proofs_job ON swarm_proofs(job_id);
CREATE TABLE plugin_settings (
      plugin_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      settings_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
CREATE TABLE plugin_migrations (
      plugin_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (plugin_id, filename)
    );
CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );
CREATE INDEX idx_swarm_jobs_task_id ON swarm_jobs(task_id);
CREATE INDEX idx_swarm_proofs_job_id ON swarm_proofs(job_id);
CREATE TABLE chat_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      emoji TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , workspace_id TEXT NOT NULL DEFAULT 'default');
CREATE TABLE chat_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      category_id TEXT NOT NULL REFERENCES chat_categories(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      agents TEXT NOT NULL DEFAULT '[]',
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , workspace_id TEXT NOT NULL DEFAULT 'default', kind TEXT NOT NULL DEFAULT 'text', topic TEXT, archived_at TEXT, last_message_preview TEXT, last_message_member_id TEXT, linked_object_refs_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
      thread_id TEXT,
      sender TEXT NOT NULL,
      sender_emoji TEXT,
      content TEXT NOT NULL,
      model TEXT,
      is_local INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'sent',
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reply_to TEXT
    , workspace_id TEXT NOT NULL DEFAULT 'default', direct_conversation_id TEXT, author_member_id TEXT, parent_message_id TEXT, thread_root_id TEXT, channel_seq INTEGER, thread_seq INTEGER, body_format TEXT NOT NULL DEFAULT 'markdown', client_nonce TEXT, quoted_message_id TEXT, edited_at TEXT, deleted_at TEXT, metadata_json TEXT);
CREATE TABLE chat_threads (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
      parent_message_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , linked_object_refs_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE chat_workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE chat_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('human', 'agent', 'service')),
      actor_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      emoji TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'offline',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(workspace_id, kind, actor_id)
    );
CREATE TABLE chat_channel_members (
      channel_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      muted INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, member_id)
    );
CREATE TABLE chat_direct_conversations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE chat_direct_conversation_members (
      conversation_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, member_id)
    );
CREATE TABLE chat_thread_state (
      root_message_id TEXT PRIMARY KEY,
      reply_count INTEGER NOT NULL DEFAULT 0,
      last_reply_at TEXT,
      last_reply_member_ids_json TEXT NOT NULL DEFAULT '[]'
    );
CREATE TABLE chat_reactions (
      message_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, member_id, emoji)
    );
CREATE TABLE chat_uploads (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      owner_member_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE chat_message_attachments (
      message_id TEXT NOT NULL,
      upload_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, upload_id)
    );
CREATE TABLE chat_events (
      id TEXT PRIMARY KEY,
      cursor TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      channel_id TEXT,
      direct_conversation_id TEXT,
      type TEXT NOT NULL,
      seq INTEGER,
      payload_json TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE chat_event_recipients (
      event_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      PRIMARY KEY (event_id, member_id)
    );
CREATE TABLE chat_channel_reads (
      channel_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      last_read_seq INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, member_id)
    );
CREATE TABLE chat_direct_reads (
      conversation_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      last_read_seq INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, member_id)
    );
CREATE TABLE chat_notification_preferences (
      member_id TEXT NOT NULL,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'channel', 'dm')),
      scope_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'mentions' CHECK (mode IN ('all', 'mentions', 'none')),
      muted_until TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (member_id, scope_type, scope_id)
    );
CREATE TABLE chat_pins (
      message_id TEXT PRIMARY KEY,
      pinned_by_member_id TEXT NOT NULL,
      pinned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE chat_message_mentions (
      message_id TEXT NOT NULL,
      mentioned_member_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, mentioned_member_id)
    );
CREATE VIRTUAL TABLE chat_messages_fts USING fts5(
      message_id UNINDEXED,
      workspace_id UNINDEXED,
      channel_id UNINDEXED,
      direct_conversation_id UNINDEXED,
      body
    )
/* chat_messages_fts(message_id,workspace_id,channel_id,direct_conversation_id,body) */;
CREATE TABLE IF NOT EXISTS 'chat_messages_fts_data'(id INTEGER PRIMARY KEY, block BLOB);
CREATE TABLE IF NOT EXISTS 'chat_messages_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS 'chat_messages_fts_content'(id INTEGER PRIMARY KEY, c0, c1, c2, c3, c4);
CREATE TABLE IF NOT EXISTS 'chat_messages_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);
CREATE TABLE IF NOT EXISTS 'chat_messages_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;
CREATE INDEX idx_chat_categories_workspace_order ON chat_categories(workspace_id, "order", name);
CREATE INDEX idx_chat_channels_workspace_order ON chat_channels(workspace_id, category_id, "order", name);
CREATE INDEX idx_chat_channels_category_order ON chat_channels(category_id, "order", name);
CREATE INDEX idx_chat_messages_channel_seq ON chat_messages(channel_id, channel_seq);
CREATE INDEX idx_chat_messages_channel_ts ON chat_messages(channel_id, timestamp, created_at);
CREATE INDEX idx_chat_messages_thread_seq ON chat_messages(thread_root_id, thread_seq);
CREATE INDEX idx_chat_messages_thread_ts ON chat_messages(thread_id, timestamp, created_at);
CREATE INDEX idx_chat_messages_dm_seq ON chat_messages(direct_conversation_id, channel_seq);
CREATE INDEX idx_chat_events_workspace_row ON chat_events(workspace_id);
CREATE INDEX idx_chat_event_recipients_member ON chat_event_recipients(member_id);
CREATE UNIQUE INDEX idx_chat_threads_parent_message ON chat_threads(parent_message_id);
CREATE UNIQUE INDEX idx_chat_nonce_channel ON chat_messages(channel_id, author_member_id, client_nonce)
      WHERE client_nonce IS NOT NULL AND direct_conversation_id IS NULL;
CREATE UNIQUE INDEX idx_chat_nonce_dm ON chat_messages(direct_conversation_id, author_member_id, client_nonce)
      WHERE client_nonce IS NOT NULL AND direct_conversation_id IS NOT NULL;
CREATE INDEX idx_chat_threads_channel_last ON chat_threads(channel_id, last_message_at DESC);
CREATE TABLE token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      session_id TEXT,
      project TEXT,
      recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      source_date TEXT NOT NULL,
      UNIQUE(source, session_id, source_date)
    );
CREATE INDEX idx_token_usage_source ON token_usage(source);
CREATE INDEX idx_token_usage_source_date ON token_usage(source_date);
CREATE INDEX idx_token_usage_recorded_at ON token_usage(recorded_at DESC);
CREATE INDEX idx_token_usage_model ON token_usage(model);
CREATE TABLE orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      deployment_mode TEXT NOT NULL DEFAULT 'saas',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , mission TEXT, domains_json TEXT NOT NULL DEFAULT '[]', blueprint_json TEXT);
CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, slug)
    );
CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default-org',
      recipient_principal_id TEXT NOT NULL,
      canonical_event_id TEXT NOT NULL,
      object_ref_json TEXT NOT NULL,
      notification_type TEXT NOT NULL,
      inbox_state TEXT NOT NULL DEFAULT 'unread',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      policy_reason_chain_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_notifications_recipient_state ON notifications(org_id, recipient_principal_id, inbox_state);
CREATE INDEX idx_notifications_event ON notifications(canonical_event_id);
CREATE INDEX idx_notifications_type ON notifications(notification_type);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE TABLE notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      external_ref TEXT,
      failure_reason TEXT,
      degraded_reason TEXT,
      policy_reason_json TEXT NOT NULL DEFAULT '{}',
      attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
CREATE INDEX idx_notification_deliveries_notification ON notification_deliveries(notification_id, attempted_at DESC, id DESC);
CREATE INDEX idx_notification_deliveries_channel_status ON notification_deliveries(channel, status);
CREATE TABLE evidence_artifacts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default-org',
      team_id TEXT,
      project_id INTEGER,
      artifact_kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body_format TEXT NOT NULL DEFAULT 'markdown',
      stable_path TEXT NOT NULL UNIQUE,
      human_path_alias TEXT,
      content_hash TEXT NOT NULL,
      mutability_policy TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      origin_task_id INTEGER,
      source_activity_event_ids_json TEXT NOT NULL DEFAULT '[]',
      source_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
      provenance_json TEXT NOT NULL DEFAULT '{}',
      integrity_state TEXT NOT NULL DEFAULT 'valid',
      availability_state TEXT NOT NULL DEFAULT 'available',
      created_by_principal_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , linked_object_refs_json TEXT NOT NULL DEFAULT '[]');
CREATE INDEX idx_evidence_artifacts_origin_task ON evidence_artifacts(origin_task_id);
CREATE INDEX idx_evidence_artifacts_org_kind ON evidence_artifacts(org_id, artifact_kind);
CREATE INDEX idx_evidence_artifacts_integrity ON evidence_artifacts(integrity_state);
CREATE TABLE evidence_artifact_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id TEXT NOT NULL REFERENCES evidence_artifacts(id),
      version INTEGER NOT NULL,
      stable_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by_principal_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(artifact_id, version)
    );
CREATE INDEX idx_evidence_artifact_versions_artifact ON evidence_artifact_versions(artifact_id, version);
CREATE TABLE native_documents (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default-org',
      team_id TEXT,
      project_id INTEGER,
      title TEXT NOT NULL,
      document_kind TEXT NOT NULL DEFAULT 'internal_doc',
      body_format TEXT NOT NULL DEFAULT 'markdown',
      stable_path TEXT NOT NULL UNIQUE,
      content_hash TEXT NOT NULL,
      mutability_policy TEXT NOT NULL DEFAULT 'editable_versioned',
      version INTEGER NOT NULL DEFAULT 1,
      lifecycle_state TEXT NOT NULL DEFAULT 'active',
      sensitivity TEXT,
      acl_json TEXT NOT NULL DEFAULT '{}',
      linked_object_refs_json TEXT NOT NULL DEFAULT '[]',
      created_by_principal_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_native_documents_org_project ON native_documents(org_id, project_id);
CREATE INDEX idx_native_documents_kind ON native_documents(document_kind);
CREATE TABLE native_document_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL REFERENCES native_documents(id),
      version INTEGER NOT NULL,
      stable_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by_principal_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(document_id, version)
    );
CREATE INDEX idx_native_document_versions_document ON native_document_versions(document_id, version);
CREATE TABLE external_document_refs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default-org',
      connector_type TEXT NOT NULL,
      external_id TEXT,
      external_url TEXT,
      title TEXT NOT NULL,
      external_mime_type TEXT,
      external_canonical_url TEXT,
      auth_state TEXT NOT NULL DEFAULT 'unknown',
      readiness_state TEXT NOT NULL DEFAULT 'unknown',
      granted_scopes_json TEXT NOT NULL DEFAULT '[]',
      missing_scopes_json TEXT NOT NULL DEFAULT '[]',
      auth_expires_at TEXT,
      external_ref_state TEXT NOT NULL DEFAULT 'unknown',
      capabilities_json TEXT NOT NULL DEFAULT '{"read":true,"index":true,"link":true,"preview":true,"write":false,"export":false,"sync":false,"create":false,"update":false}',
      canonicality TEXT NOT NULL DEFAULT 'unknown',
      last_indexed_at TEXT,
      last_checked_at TEXT,
      entity_visibility_policy_json TEXT NOT NULL DEFAULT '{}',
      external_permission_summary TEXT,
      linked_object_refs_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_external_document_refs_org_connector ON external_document_refs(org_id, connector_type);
CREATE INDEX idx_external_document_refs_external_id ON external_document_refs(connector_type, external_id);
CREATE INDEX idx_activities_event_type ON activities(activity_event_type);
CREATE INDEX idx_tasks_org_updated_at ON tasks(org_id, updated_at DESC, id DESC);
CREATE INDEX idx_tasks_team_updated_at ON tasks(team_id, updated_at DESC, id DESC);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_projects_org_team ON projects(org_id, team_id, id);
CREATE INDEX idx_task_projects_org_task_id ON task_projects(org_id, task_id);
CREATE INDEX idx_tasks_parent_task_id_metadata ON tasks(
      CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parent_task_id') AS INTEGER) END
    );
CREATE INDEX idx_tasks_parent_task_id_camel_metadata ON tasks(
      CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parentTaskId') AS INTEGER) END
    );
CREATE INDEX idx_tasks_parent_id_metadata ON tasks(
      CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parent_id') AS INTEGER) END
    );
CREATE INDEX idx_task_comments_task_id_id ON task_comments(task_id, id);
CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      email TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, provider_account_id)
    );
CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE org_memberships (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, user_id)
    );
CREATE TABLE team_memberships (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, team_id, user_id)
    );
CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(session_token_hash);
CREATE INDEX idx_org_memberships_user ON org_memberships(user_id, status);
CREATE INDEX idx_team_memberships_user ON team_memberships(user_id, status);
CREATE INDEX idx_team_memberships_scope ON team_memberships(org_id, team_id, status);
CREATE TABLE agent_import_mappings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      team_ids_json TEXT NOT NULL,
      module_ids_json TEXT NOT NULL,
      channel_ids_json TEXT NOT NULL,
      review_policy_json TEXT NOT NULL,
      imported_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, source_agent_id TEXT,
      UNIQUE(org_id, source, external_id),
      UNIQUE(agent_id)
    );
CREATE INDEX idx_agent_import_mappings_org
      ON agent_import_mappings(org_id, updated_at DESC);
CREATE TABLE agent_import_receipts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, idempotency_key)
    );
CREATE TABLE chat_channel_scopes (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL UNIQUE,
      org_id TEXT NOT NULL,
      team_id TEXT,
      scoped_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE INDEX idx_chat_channel_scopes_org
      ON chat_channel_scopes(org_id, team_id, channel_id);
CREATE TABLE chat_history_access_grants (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      team_id TEXT,
      channel_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      granted_by_user_id TEXT NOT NULL,
      revoked_at TEXT,
      revoked_by_user_id TEXT,
      revocation_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, channel_id, agent_id)
    );
CREATE INDEX idx_chat_history_access_active
      ON chat_history_access_grants(org_id, agent_id, channel_id, revoked_at);
CREATE TABLE chat_noise_cooldowns (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT,
      channel_id TEXT NOT NULL, agent_id TEXT NOT NULL, cooldown_seconds INTEGER NOT NULL,
      configured_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(org_id, channel_id, agent_id)
    );
CREATE TABLE chat_noise_mutes (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT,
      team_scope TEXT NOT NULL DEFAULT '', scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, muted_by_user_id TEXT NOT NULL,
      reason TEXT NOT NULL, cleared_at TEXT, cleared_by_user_id TEXT, clear_reason TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(org_id, scope_type, scope_id, team_scope)
    );
CREATE TABLE chat_noise_reservations (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT, category_id TEXT NOT NULL,
      channel_id TEXT NOT NULL, agent_id TEXT NOT NULL, state TEXT NOT NULL,
      attempted_at TEXT NOT NULL, completed_at TEXT, released_at TEXT, release_reason TEXT,
      override_actor_user_id TEXT, override_reason TEXT
    );
CREATE INDEX idx_chat_noise_reservation_target
      ON chat_noise_reservations(org_id, channel_id, agent_id, state, attempted_at);
CREATE TABLE chat_noise_audit (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT, action TEXT NOT NULL,
      channel_id TEXT, category_id TEXT, agent_id TEXT, reservation_id TEXT,
      actor_user_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL
    );
CREATE INDEX idx_chat_noise_audit_org
      ON chat_noise_audit(org_id, created_at DESC);
CREATE TABLE task_handoffs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      source_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_agent_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked', 'completed', 'cancelled')),
      reason TEXT,
      created_by_principal_id TEXT NOT NULL,
      accepted_by_principal_id TEXT,
      last_transition_by_principal_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      accepted_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      CHECK (source_task_id <> target_task_id)
    );
CREATE UNIQUE INDEX idx_task_handoffs_active_unique
      ON task_handoffs(org_id, source_task_id, target_task_id, target_agent_id)
      WHERE status <> 'cancelled';
CREATE INDEX idx_task_handoffs_source
      ON task_handoffs(org_id, source_task_id, status, created_at);
CREATE INDEX idx_task_handoffs_target
      ON task_handoffs(org_id, target_task_id, status, created_at);
CREATE TABLE task_handoff_events (
      id TEXT PRIMARY KEY,
      handoff_id TEXT NOT NULL REFERENCES task_handoffs(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_principal_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
CREATE INDEX idx_task_handoff_events_handoff
      ON task_handoff_events(org_id, handoff_id, created_at);
CREATE TABLE business_onboarding_drafts (
      org_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      draft_json TEXT NOT NULL,
      updated_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE business_onboarding_receipts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      disabled_at TEXT,
      UNIQUE(org_id, idempotency_key)
    );
CREATE UNIQUE INDEX uq_business_onboarding_receipts_org
      ON business_onboarding_receipts(org_id);
CREATE TABLE org_invites (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      accepted_at TEXT,
      invited_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, email)
    );
CREATE TABLE provider_health_samples (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('openai', 'azure-openai', 'smtp')),
      provider_type TEXT NOT NULL CHECK (provider_type IN ('llm', 'email')),
      status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'down')),
      source TEXT NOT NULL CHECK (source IN ('scheduled-probe', 'manual-probe', 'recovery-probe', 'runtime')),
      error_code TEXT,
      remediation TEXT NOT NULL,
      message TEXT NOT NULL,
      latency_ms INTEGER,
      checked_at TEXT NOT NULL,
      recovery_receipt_id TEXT
    );
CREATE INDEX idx_provider_health_checked
      ON provider_health_samples(provider, checked_at DESC);
CREATE TABLE provider_recovery_receipts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('openai', 'azure-openai', 'smtp')),
      trigger TEXT NOT NULL CHECK (trigger IN ('automatic', 'manual')),
      action TEXT NOT NULL CHECK (action IN ('reload-and-probe', 'reconnect')),
      outcome TEXT NOT NULL CHECK (outcome IN ('recovered', 'still-degraded', 'blocked', 'failed')),
      actor_user_id TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      message TEXT NOT NULL
    );
CREATE INDEX idx_provider_recovery_completed
      ON provider_recovery_receipts(provider, completed_at DESC);
CREATE TABLE curacel_review_policies (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL, review_required INTEGER NOT NULL CHECK(review_required IN (0,1)),
      approver_roles_json TEXT NOT NULL, actor_principal_id TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(org_id, team_id, action)
    );
CREATE INDEX idx_curacel_review_policy_org ON curacel_review_policies(org_id, team_id);
CREATE TABLE curacel_connectors (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL, name TEXT NOT NULL, credential_ref TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled = 0),
      mode TEXT NOT NULL DEFAULT 'dry_run' CHECK(mode = 'dry_run'),
      review_required INTEGER NOT NULL DEFAULT 1 CHECK(review_required = 1),
      actor_principal_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(org_id, team_id, type, name)
    );
CREATE INDEX idx_curacel_connectors_org ON curacel_connectors(org_id, team_id);
CREATE TABLE curacel_connector_drafts (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, connector_id TEXT NOT NULL REFERENCES curacel_connectors(id) ON DELETE CASCADE,
      actor_principal_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, target_ref TEXT NOT NULL,
      payload_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending_review' CHECK(state = 'pending_review'),
      review_required INTEGER NOT NULL DEFAULT 1 CHECK(review_required = 1),
      delivery_attempted INTEGER NOT NULL DEFAULT 0 CHECK(delivery_attempted = 0),
      created_at TEXT NOT NULL, UNIQUE(org_id, idempotency_key)
    );
CREATE TABLE curacel_operational_audit (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT, agent_id TEXT, task_id INTEGER,
      actor_principal_id TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL,
      outcome TEXT NOT NULL, detail_json TEXT NOT NULL, idempotency_key TEXT, created_at TEXT NOT NULL
    );
CREATE UNIQUE INDEX idx_curacel_audit_idempotency
      ON curacel_operational_audit(org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_curacel_audit_filters
      ON curacel_operational_audit(org_id, team_id, agent_id, task_id, created_at);
CREATE TABLE curacel_execution_samples (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT, agent_id TEXT NOT NULL, task_id INTEGER,
      outcome TEXT NOT NULL CHECK(outcome IN ('success','error')), latency_ms INTEGER NOT NULL CHECK(latency_ms >= 0),
      retries INTEGER NOT NULL CHECK(retries >= 0), muted INTEGER NOT NULL CHECK(muted IN (0,1)),
      rate_limited INTEGER NOT NULL CHECK(rate_limited IN (0,1)), review_outcome TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
CREATE INDEX idx_curacel_execution_report
      ON curacel_execution_samples(org_id, team_id, agent_id, created_at);
CREATE TABLE curacel_team_dashboards (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT NOT NULL, team_type TEXT NOT NULL,
      queue_label TEXT NOT NULL, approval_sla_minutes INTEGER NOT NULL CHECK(approval_sla_minutes > 0),
      policies_json TEXT NOT NULL, agent_permissions_json TEXT NOT NULL, actor_principal_id TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(org_id, team_id)
    );
CREATE INDEX idx_curacel_dashboards_org ON curacel_team_dashboards(org_id);
CREATE TABLE entity_agent_id_tombstones (
      agent_id TEXT PRIMARY KEY,
      deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
