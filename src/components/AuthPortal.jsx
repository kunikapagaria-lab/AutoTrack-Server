import { useState } from 'react';
import { useShop } from '../context/ShopContext';
import { 
  ShieldCheck, User, Mail, Lock, ArrowRight, 
  ChevronRight, Briefcase, Eye, EyeOff 
} from 'lucide-react';

export default function AuthPortal() {
  const { login, signup } = useShop();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    role: 'staff'
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'login') {
      login(formData.email, formData.password);
    } else {
      signup(formData);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">
            <ShieldCheck size={40} strokeWidth={2.5} />
          </div>
          <h1 className="auth-title">
            {mode === 'login' ? 'Welcome Back' : 'Create Account'}
          </h1>
          <p className="auth-subtitle">
            {mode === 'login' 
              ? 'Access the AutoTrack workshop portal' 
              : 'Join the next-gen vehicle tracking network'
            }
          </p>
        </div>

        <div className="auth-tabs">
          <button 
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => setMode('login')}
          >
            Sign In
          </button>
          <button 
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => setMode('signup')}
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="auth-input-group">
              <label className="auth-label">Username</label>
              <div className="auth-input-wrapper">
                <User size={18} className="auth-input-icon" />
                <input 
                  type="text"
                  name="username"
                  required
                  placeholder="john_doe"
                  className="auth-input"
                  value={formData.username}
                  onChange={handleChange}
                />
              </div>
            </div>
          )}

          <div className="auth-input-group">
            <label className="auth-label">Email Address</label>
            <div className="auth-input-wrapper">
              <Mail size={18} className="auth-input-icon" />
              <input 
                type="email"
                name="email"
                required
                placeholder="mechanic@autotrack.io"
                className="auth-input"
                value={formData.email}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label className="auth-label">Password</label>
            <div className="auth-input-wrapper">
              <Lock size={18} className="auth-input-icon" />
              <input 
                type={showPassword ? "text" : "password"}
                name="password"
                required
                placeholder="••••••••"
                className="auth-input"
                value={formData.password}
                onChange={handleChange}
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ 
                  position: 'absolute', 
                  right: '1.25rem', 
                  background: 'none', 
                  border: 'none', 
                  color: 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {mode === 'signup' && (
            <div className="auth-input-group">
              <label className="auth-label">Login As</label>
              <div className="auth-input-wrapper">
                <Briefcase size={18} className="auth-input-icon" />
                <select 
                  name="role"
                  className="auth-select"
                  value={formData.role}
                  onChange={handleChange}
                >
                  <option value="staff">Workshop Staff</option>
                  <option value="admin">System Administrator</option>
                </select>
                <ChevronRight size={18} style={{ position: 'absolute', right: '1.5rem', color: 'var(--text-secondary)', pointerEvents: 'none', transform: 'rotate(90deg)' }} />
              </div>
            </div>
          )}

          <button type="submit" className="auth-submit-btn">
            {mode === 'login' ? 'Access Workshop' : 'Get Started'}
            <ArrowRight size={20} />
          </button>
        </form>

        <div className="auth-footer">
          System ID: WS-M-2024 • Powered by AutoSense AI
        </div>
      </div>
    </div>
  );
}
