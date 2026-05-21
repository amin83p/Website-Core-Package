// MVC/controllers/styleController.js
const fs = require('fs').promises;
const path = require('path');

// PATH TO MAIN.CSS
const cssPath = path.join(__dirname, '../../public/styles/main.css');

// MARKER FOR BUTTON SECTION
const BUTTON_SECTION_MARKER = '/* ==========================================================================\n   15. CUSTOM BUTTONS (MANAGED BY BUTTON STUDIO)\n   ========================================================================== */';

/* ==========================================================================
   HELPERS
   ========================================================================== */

// Helper: Categorize CSS Variables
const getCategory = (key) => {
    if (key.startsWith('--color')) return 'Colors';
    if (key.startsWith('--spacing') || key.startsWith('--header') || key.startsWith('--notice')) return 'Spacing & Layout';
    if (key.startsWith('--size')) return 'Typography & Scaling';
    if (key.startsWith('--border') || key.startsWith('--shadow')) return 'Borders & Effects';
    if (key.startsWith('--transition')) return 'Animations';
    return 'Other';
};

// Helper: Parse CSS Variables
async function parseCssVariables() {
    try {
        const content = await fs.readFile(cssPath, 'utf8');
        const rootMatch = content.match(/:root\s*{([^}]*)}/s);
        if (!rootMatch) return {};

        const rootContent = rootMatch[1];
        const variables = {};
        const varRegex = /--([\w-]+)\s*:\s*([^;]+);/g;
        let match;

        while ((match = varRegex.exec(rootContent)) !== null) {
            variables[`--${match[1]}`] = match[2].trim();
        }
        return variables;
    } catch (err) {
        console.error("Error reading CSS:", err);
        throw new Error("Could not read style file.");
    }
}

// Helper: Parse ALL Buttons (System + Custom)
async function getButtonsFromCss(cssContent) {
    const customButtons = [];
    const systemButtons = [];
    const managedNames = new Set();

    // 1. Parse MANAGED Buttons (The ones created by this tool)
    // Regex looks for: /* [BTN: name] */ .name { ... }
    const managedRegex = /\/\* \[BTN: ([\w-]+)\] \*\/\s*\.([\w-]+)\s*\{([^}]+)\}\s*\.([\w-]+):hover\s*\{([^}]+)\}/g;
    
    let match;
    while ((match = managedRegex.exec(cssContent)) !== null) {
        const className = match[1];
        managedNames.add(className);

        const normalBlock = match[3];
        const hoverBlock = match[5];

        // Extract properties for the editor
        const bgMatch = normalBlock.match(/background-color:\s*([^;]+);/);
        const colorMatch = normalBlock.match(/color:\s*([^;]+);/);
        const radiusMatch = normalBlock.match(/border-radius:\s*([^;]+);/);
        const transformMatch = hoverBlock.match(/transform:\s*([^;]+);/);

        customButtons.push({
            name: className,
            bg: bgMatch ? bgMatch[1].trim() : '#0d6efd',
            color: colorMatch ? colorMatch[1].trim() : '#ffffff',
            radius: radiusMatch ? parseInt(radiusMatch[1]) : 4,
            hover: transformMatch ? transformMatch[1].trim() : 'none',
            isSystem: false
        });
    }

    // 2. Parse SYSTEM Buttons (Standard classes found in main.css)
    // We look for .btn-* definitions that are NOT managed overrides
    const systemRegex = /\.btn-([a-z0-9-]+)(?:\s+|:)/g;
    let sysMatch;
    
    while ((sysMatch = systemRegex.exec(cssContent)) !== null) {
        const className = 'btn-' + sysMatch[1];
        
        // Skip if this is actually a managed button (Override)
        if (managedNames.has(className)) continue;
        
        // Push a "skeleton" object. 
        // We rely on the Frontend JS to compute the actual colors using window.getComputedStyle
        // because parsing them from raw CSS without a full parser is unreliable.
        systemButtons.push({
            name: className,
            bg: '#eeeeee',    // Placeholder
            color: '#333333', // Placeholder
            radius: 4,
            hover: 'translateY(-3px)',
            isSystem: true
        });
    }

    // Remove duplicates from system list (e.g. .btn-primary defined multiple times for focus/hover)
    const uniqueSystem = systemButtons.filter((v,i,a)=>a.findIndex(t=>(t.name===v.name))===i);

    return { customButtons, systemButtons: uniqueSystem };
}

/* ==========================================================================
   CONTROLLERS
   ========================================================================== */

// 1. THEME EDITOR (Variables)
async function showStyleEditor(req, res) {
    try {
        const variables = await parseCssVariables();
        
        const grouped = {};
        Object.keys(variables).forEach(key => {
            const cat = getCategory(key);
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push({ key, value: variables[key] });
        });

        res.render('admin/style/styleEditor', {
            title: 'Visual Theme Editor',
            grouped,
            user: req.user,
            success: req.query.success
        });
    } catch (error) {
    res.status(500).json({
      error,
      status: 'error',
      message: 'Failed to load quick menu.'
    });
    }
}

async function saveStyles(req, res) {
    try {
        const updates = req.body; 
        let content = await fs.readFile(cssPath, 'utf8');

        // Backup
        await fs.writeFile(`${cssPath}.backup`, content);

        // Replace Variable Values
        Object.keys(updates).forEach(key => {
            if (key.startsWith('--')) {
                const regex = new RegExp(`(${key}\\s*:\\s*)([^;]+)(;)`, 'g');
                if (regex.test(content)) {
                    content = content.replace(regex, `$1${updates[key]}$3`);
                }
            }
        });

        await fs.writeFile(cssPath, content);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Theme updated successfully.' });
        }
        res.redirect('/styles?success=true');

    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: 'Failed to save.' });
    res.status(500).json({
      error,
      status: 'error',
      message: 'Failed to load quick menu.'
    });
    }
}

async function showTableStyler(req, res) {
    try {
        const variables = await parseCssVariables();
        
        const tableVars = {
            // Existing Table Vars
            headerBg: variables['--table-header-bg'] || '#e7f1ff',
            headerText: variables['--table-header-text'] || '#333333',
            borderColor: variables['--table-border-color'] || '#dee2e6',
            rowHover: variables['--table-row-hover'] || '#f8f9fa',
            stripeBg: variables['--table-stripe-bg'] || '#ffffff',
            paddingY: variables['--table-padding-y'] || '12px',
            fontSize: variables['--table-font-size'] || '1rem',
            actionDir: variables['--table-action-dir'] || 'row',
            radius: variables['--table-radius'] || '8px',

            // ✅ NEW: Controls Vars
            controlBg: variables['--control-bg'] || '#ffffff',
            controlBorder: variables['--control-border'] || '#dee2e6',
            controlText: variables['--control-text'] || '#333333',
            controlRadius: variables['--control-radius'] || '5px',
            switchColor: variables['--switch-checked-bg'] || '#0d6efd'
        };

        res.render('admin/style/tableStyler', {
            title: 'Table Styler',
            tableVars,
            user: req.user
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, error, user: req.user });
    }
}
// 2. BUTTON STUDIO (Buttons)
async function listButtons(req, res) {
    try {
        let content = await fs.readFile(cssPath, 'utf8');
        
        // Ensure marker exists
        if (!content.includes('15. CUSTOM BUTTONS')) {
            content += '\n\n' + BUTTON_SECTION_MARKER + '\n';
            await fs.writeFile(cssPath, content);
        }

        // ✅ THIS LINE FIXES YOUR ERROR: It gets BOTH arrays
        const { customButtons, systemButtons } = await getButtonsFromCss(content);
        
        res.render('admin/style/buttonManager', {
            title: 'Button Studio',
            customButtons, // Passed explicitly
            systemButtons, // Passed explicitly
            buttons: customButtons, // Fallback for any legacy code
            user: req.user
        });
    } catch (error) {
    res.status(500).json({
      error,
      status: 'error',
      message: 'Failed to load quick menu.'
    });
    }
}

async function saveButton(req, res) {
    try {
        const { oldName, name, bg, color, radius, hover } = req.body;
        
        // Clean name (remove . if present)
        let className = name.trim().replace(/^\./, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
        if (!className) throw new Error("Invalid class name");

        // CSS Template
        const cssBlock = `/* [BTN: ${className}] */
.${className} {
  background-color: ${bg};
  color: ${color};
  border: none;
  border-radius: ${radius}px;
  transition: transform 0.15s ease;
}
.${className}:hover {
  background-color: ${bg};
  color: ${color} !important;
  opacity: 0.9;
  transform: ${hover};
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}`;

        let content = await fs.readFile(cssPath, 'utf8');

        // 1. Remove Old Definition (if updating an existing managed button)
        const targetName = oldName || className;
        const removeRegex = new RegExp(`\\/\\* \\[BTN: ${targetName}\\] \\*\\/[\\s\\S]*?:hover\\s*\\{[^}]+\\}`, 'g');
        content = content.replace(removeRegex, '');

        // 2. Append New Block
        content = content.trim() + '\n\n' + cssBlock;

        await fs.writeFile(cssPath, content);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Button saved successfully.' });
        }
        res.redirect('/styles/buttons');

    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).json({
      error,
      status: 'error',
      message: 'Failed to load quick menu.'
    });
    }
}

async function deleteButton(req, res) {
    try {
        const { name } = req.body;
        let content = await fs.readFile(cssPath, 'utf8');

        // Remove block
        const removeRegex = new RegExp(`\\/\\* \\[BTN: ${name}\\] \\*\\/[\\s\\S]*?:hover\\s*\\{[^}]+\\}`, 'g');
        content = content.replace(removeRegex, '').trim();

        await fs.writeFile(cssPath, content);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Button deleted/restored.' });
        }
        res.redirect('/styles/buttons');

    } catch (error) {
    res.status(500).json({
      error,
      status: 'error',
      message: 'Failed to load quick menu.'
    });
    }
}


async function showFooterStyler(req, res) {
    try {
        const variables = await parseCssVariables();
        
        const footerVars = {
            bg: variables['--footer-bg'] || '#343a40',
            text: variables['--footer-text'] || '#ffffff',
            link: variables['--footer-link'] || '#adb5bd',
            linkHover: variables['--footer-link-hover'] || '#ffffff',
            padding: variables['--footer-padding'] || '40px',
            inputBg: variables['--footer-input-bg'] || '#ffffff'
        };

        res.render('admin/style/footerStyler', {
            title: 'Footer Styler',
            footerVars,
            user: req.user
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, error, user: req.user });
    }
}

async function showHeaderStyler(req, res) {
    try {
        const variables = await parseCssVariables();
        
        const headerVars = {
            bg: variables['--header-bg'] || '#ffffff',
            shadow: variables['--header-shadow'] || '0 2px 4px rgba(0, 0, 0, 0.1)',
            paddingY: variables['--header-padding-y'] || '20px',
            paddingShrunk: variables['--header-padding-shrunk'] || '5px',
            contentWidth: variables['--header-content-width'] || '80%',
            
            logoHeight: variables['--logo-height'] || '50px',
            logoHeightShrunk: variables['--logo-height-shrunk'] || '30px',
            
            navColor: variables['--nav-link-color'] || '#333333',
            navHover: variables['--nav-link-hover'] || '#007bff',
            navSize: variables['--nav-font-size'] || '1rem',
            
            noticeBg: variables['--notice-bg'] || '#f8f9fa',
            noticeText: variables['--notice-text'] || '#333333'
        };

        res.render('admin/style/headerStyler', {
            title: 'Header Styler',
            headerVars,
            user: req.user
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, error, user: req.user });
    }
}

async function showDashboardStyler(req, res) {
    try {
        const variables = await parseCssVariables();
        
        const dashVars = {
            // Hero
            heroBg1: variables['--dash-hero-bg-1'] || '#eff6ff',
            heroBg2: variables['--dash-hero-bg-2'] || '#e6fffa',
            heroBorder: variables['--dash-hero-border'] || '#f0f0f0',
            heroText: variables['--dash-hero-text'] || '#333333',
            heroRadius: variables['--dash-hero-radius'] || '18px',

            // Stat Cards
            statBg: variables['--dash-stat-bg'] || '#ffffff',
            statBorder: variables['--dash-stat-border'] || '#f0f0f0',
            statRadius: variables['--dash-stat-radius'] || '16px',

            // Module Cards
            cardBg: variables['--dash-card-bg'] || '#ffffff',
            cardBorder: variables['--dash-card-border'] || '#f0f0f0',
            cardRadius: variables['--dash-card-radius'] || '18px',
            
            // Icons & Accents
            iconBg: variables['--dash-icon-bg'] || 'rgba(0,123,255,0.1)',
            iconColor: variables['--dash-icon-color'] || '#007bff',
            accentColor: variables['--dash-accent-color'] || 'rgba(13,110,253,0.15)'
        };

        res.render('admin/style/dashboardStyler', {
            title: 'Dashboard Styler',
            dashVars,
            user: req.user
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, error, user: req.user });
    }
}

async function showModalStyler(req, res) {
    try {
        const variables = await parseCssVariables();
        
        const modalVars = {
            bg: variables['--modal-bg'] || '#ffffff',
            headerBg: variables['--modal-header-bg'] || '#ffffff',
            headerText: variables['--modal-header-text'] || '#333333',
            borderColor: variables['--modal-border-color'] || '#dee2e6',
            radius: variables['--modal-radius'] || '12px',
            
            // Backdrop
            backdropColor: variables['--modal-backdrop-color'] || '#000000',
            backdropOpacity: variables['--modal-backdrop-opacity'] || '0.5',
            backdropBlur: variables['--modal-backdrop-blur'] || '0px'
        };

        res.render('admin/style/modalStyler', {
            title: 'Modal Styler',
            modalVars,
            user: req.user
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, error, user: req.user });
    }
}

async function showSearchStyler(req, res) {
    try {
        const variables = await parseCssVariables();
        
        const searchVars = {
            // Standard Page Search
            radius: variables['--search-radius'] || '5px',
            borderColor: variables['--search-border-color'] || '#f8f9fa',
            focusRing: variables['--search-focus-ring'] || 'rgba(0, 123, 255, 0.25)',
            
            // Header Search (Pill)
            headerBg: variables['--header-search-bg'] || '#f8f9fa',
            headerBorder: variables['--header-search-border'] || '#007bff',
            headerRadius: variables['--header-search-radius'] || '25px',
            headerWidth: variables['--header-search-width'] || '220px'
        };

        res.render('admin/style/searchStyler', {
            title: 'Search Components',
            searchVars,
            user: req.user
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, error, user: req.user });
    }
}

// ... existing exports ...
module.exports = { 
    showStyleEditor, showTableStyler, showFooterStyler, showHeaderStyler, 
    showDashboardStyler, showModalStyler, showSearchStyler, // Export new function
    saveStyles, listButtons, saveButton, deleteButton 
};