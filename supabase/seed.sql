-- Fictional fixtures only. The original operational roster is not included.
insert into projects(id,name,description,default_budget_usd) values
('00000000-0000-4000-8000-000000000001','Relay / release readiness','A fictional release workflow for the engineering showcase.',5);

insert into agents(id,name,display_name,avatar,machine_id,status,model,system_prompt,daily_budget_usd) values
('00000000-0000-4000-8000-00000000000a','atlas','Atlas','◈','demo-node-01','idle','fixture-engine','Fictional technical worker. Attach evidence.',5),
('00000000-0000-4000-8000-00000000000b','signal','Signal','◎','demo-node-02','idle','fixture-engine','Fictional research worker. Attach evidence.',5),
('00000000-0000-4000-8000-00000000000c','relay','Relay','⌁','demo-node-03','idle','fixture-engine','Fictional operations worker. Attach evidence.',5);
insert into agent_capabilities(agent_id,skill,proficiency) values
('00000000-0000-4000-8000-00000000000a','tech',5),
('00000000-0000-4000-8000-00000000000b','research',5),
('00000000-0000-4000-8000-00000000000c','ops',5);
update agents set last_heartbeat_at=now();

-- Prices are configuration examples in the source, not current provider quotes.
update system_state set value='{}' where key='model_prices';
insert into events(event_type,actor_type,subject_type,subject_id,payload) values
('project.created','human','project','00000000-0000-4000-8000-000000000001','{"schema_version":1,"data":{"name":"Relay / release readiness","fixture":true}}');
