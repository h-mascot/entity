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
CREATE TABLE orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      deployment_mode TEXT NOT NULL DEFAULT 'saas',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
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
CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default-org',
      team_id TEXT NOT NULL DEFAULT 'default-team',
      project_id INTEGER,
      created_by_principal_id TEXT DEFAULT 'legacy-system',
      initiator_principal_id TEXT DEFAULT 'legacy-unknown',
      initiator_type TEXT DEFAULT 'unknown',
      owner_principal_id TEXT DEFAULT 'legacy-owner',
      owner_principal_type TEXT DEFAULT 'unknown',
      executor_principal_id TEXT,
      assignment_state TEXT DEFAULT 'unassigned',
      taskmaster_drivable INTEGER NOT NULL DEFAULT 0,
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
    , brief TEXT, origin_channel TEXT, due_date TEXT, priority TEXT DEFAULT 'P2', estimate_hours REAL, time_spent REAL DEFAULT 0, output TEXT, progress_status TEXT DEFAULT 'backlog', recurring INTEGER DEFAULT 0, recurring_config TEXT, model TEXT, archived INTEGER DEFAULT 0, worktype TEXT NOT NULL DEFAULT 'general', risk_level TEXT NOT NULL DEFAULT 'low', agent_trust_level TEXT NOT NULL DEFAULT 'unknown', policy_inputs_json TEXT NOT NULL DEFAULT '{}', external_side_effects_json TEXT NOT NULL DEFAULT '[]', review_required INTEGER NOT NULL DEFAULT 0, review_state TEXT NOT NULL DEFAULT 'not_required', human_gate_required INTEGER NOT NULL DEFAULT 0, human_gate_state TEXT NOT NULL DEFAULT 'not_required');
CREATE INDEX idx_tasks_column ON tasks(column);
CREATE INDEX idx_tasks_updated_at ON tasks(updated_at DESC);
CREATE TABLE activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'agent',
      type TEXT NOT NULL,
      activity_event_type TEXT,
      activity_event_payload_version INTEGER NOT NULL DEFAULT 1,
      activity_event_payload_json TEXT,
      activity_event_schema_status TEXT NOT NULL DEFAULT 'legacy_mapped',
      activity_event_legacy_type TEXT,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      agent_name TEXT,
      agent_emoji TEXT,
      file_path TEXT,
      task_id INTEGER,
      task_column TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
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
      org_id TEXT NOT NULL DEFAULT 'default-org',
      team_id TEXT NOT NULL DEFAULT 'default-team',
      name TEXT NOT NULL,
      color TEXT,
      lifecycle_state TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
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
      org_id TEXT NOT NULL DEFAULT 'default-org',
      project_id INTEGER NOT NULL,
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
CREATE INDEX idx_activities_event_type ON activities(activity_event_type);
CREATE INDEX idx_tasks_org_updated_at ON tasks(org_id, updated_at DESC, id DESC);
CREATE INDEX idx_tasks_team_updated_at ON tasks(team_id, updated_at DESC, id DESC);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_projects_org_team ON projects(org_id, team_id, id);
CREATE INDEX idx_task_projects_org_task_id ON task_projects(org_id, task_id);
CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );
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
CREATE TABLE swarm_jobs (
  id TEXT PRIMARY KEY,
  task_id INTEGER,
  title TEXT NOT NULL,
  spec TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT,
  provider TEXT NOT NULL DEFAULT 'acp',
  status TEXT NOT NULL DEFAULT 'draft',
  priority TEXT NOT NULL DEFAULT 'medium',
  context_file TEXT,
  run_handle TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  feedback TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at TEXT,
  completed_at TEXT
);
CREATE INDEX idx_swarm_jobs_task_id ON swarm_jobs(task_id);
CREATE INDEX idx_swarm_jobs_status ON swarm_jobs(status);
CREATE TABLE swarm_proofs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES swarm_jobs(id),
  provider TEXT NOT NULL,
  commit_sha TEXT,
  branch TEXT,
  build_log TEXT,
  test_result TEXT,
  test_output TEXT,
  screenshots TEXT,
  artifacts TEXT,
  duration_sec INTEGER,
  proof_type TEXT NOT NULL DEFAULT 'artifact',
  proof_ref TEXT NOT NULL DEFAULT 'proof',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_swarm_proofs_job_id ON swarm_proofs(job_id);
CREATE TABLE chat_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      emoji TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
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
    , linked_object_refs_json TEXT NOT NULL DEFAULT '[]');
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
    );
CREATE TABLE chat_threads (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
      parent_message_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , linked_object_refs_json TEXT NOT NULL DEFAULT '[]');
CREATE INDEX idx_chat_channels_category_order ON chat_channels(category_id, "order", name);
CREATE INDEX idx_chat_messages_channel_ts ON chat_messages(channel_id, timestamp, created_at);
CREATE INDEX idx_chat_messages_thread_ts ON chat_messages(thread_id, timestamp, created_at);
CREATE INDEX idx_chat_threads_channel_last ON chat_threads(channel_id, last_message_at DESC);
CREATE UNIQUE INDEX idx_chat_threads_parent_message ON chat_threads(parent_message_id);
CREATE INDEX idx_swarm_jobs_task   ON swarm_jobs(task_id);
CREATE INDEX idx_swarm_proofs_job ON swarm_proofs(job_id);
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
      capabilities_json TEXT NOT NULL DEFAULT '{"read":true,"index":true,"link":true,"preview":true,"write":false}',
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
