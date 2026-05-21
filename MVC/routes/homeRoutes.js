const express = require('express');
const router  = express.Router();
const homeCtrl = require('../controllers/homeController');
const publicPageContentSettingsDataService = require('../services/publicPageContentSettingsDataService');


router.get('/', homeCtrl.getHome);

router.get(['/about', 'aboutus', 'about-us'], async (req, res, next)=>{
    try {
        const publicPageContent = await publicPageContentSettingsDataService.getPublicPageContentModel();
        res.render('about',{
            title: 'About Us',
            htmlClass: 'pte-public-root',
            bodyClass: 'pte-public-body public-zoom-centered-body',
            mainClass: 'container pte-public-main about-public-main',
            publicPageContent,
            aboutContent: publicPageContent.about,
            user: req.user
        })
    } catch (error) {
        next(error);
    }
})
router.get(['/whatWeOffer', '/whatIOffer'], async (req, res, next)=>{
    try {
        const publicPageContent = await publicPageContentSettingsDataService.getPublicPageContentModel();
        res.render('whatIOffer',{
            title: 'Projects',
            htmlClass: 'pte-public-root',
            bodyClass: 'pte-public-body public-zoom-centered-body projects-public-body',
            mainClass: 'container pte-public-main projects-public-main',
            publicPageContent,
            projectsContent: publicPageContent.projects,
            user: req.user
        })
    } catch (error) {
        next(error);
    }
})

router.get(['/biography', '/bio'], (req, res)=>{
    res.render('biography',{
        title: 'My Bio - Amin Paknejad',
        htmlClass: 'pte-public-root',
        bodyClass: 'pte-public-body public-zoom-centered-body',
        mainClass: 'container pte-public-main',
        bio: null,
        user: req.user
    })
})

// router.get(['/contact', '/contactus'], (req, res)=>{
//     res.render('contact',{
//         title: 'Contact Amin',
//         user: req.user
//     })
// })

module.exports = router;
