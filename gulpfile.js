var gulp = require('gulp'),
    uglify = require('gulp-uglify'),
    rename = require('gulp-rename'),
    footer = require('gulp-footer');

// Include the js, which actually includes other js via gulp-include directives
gulp.task('build.js', function() {
    return gulp.src('src/*.js')
    .pipe(uglify())
    .pipe(rename('init-2.min.js'))
    .pipe(footer("\n/* Built: " + (new Date().toString()) + " */"))
    .pipe(gulp.dest('dist'));
});

gulp.task('default', ['build.js'], function() {});