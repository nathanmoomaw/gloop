# ROADMAP

## Active

- [ ] Migrate `ScriptProcessor` grain capture to an `AudioWorklet` (ScriptProcessor is deprecated)
- [ ] Provision AWS infra for gloop.obfusco.us (S3 bucket, CloudFront distribution, Route53 record) + gloop-dev.obfusco.us — needs explicit go-ahead before creating billed infra
- [ ] GitHub Actions deploy workflow (mirror now/moveloose's S3+CloudFront pattern) once infra exists
- [ ] Tune default grain size / feedback / spread for a good out-of-the-box first impression
- [ ] Mobile mic permission UX pass

## Completed

- [x] GitHub repo + local project scaffold
- [x] Vite + React build setup
- [x] Mic → grain pool → feedback delay network (engine.js)
- [x] Chladni nodal-pattern grain-field visualization (GrainField.jsx)
- [x] Standard project mds (CLAUDE, ETHOS, MYTHOS, DEVLOG)
- [x] DUMP.md wired to LIFE hub
